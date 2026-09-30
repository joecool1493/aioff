import { describe, expect, it } from 'vitest';
import { anchorRegex, Hider, HIDDEN_ATTR, isUnsafeTarget, type ResolvedHide } from '../src/index.ts';

const rule = (over: Partial<ResolvedHide>): ResolvedHide => ({
  ruleId: 'r',
  siteId: 's',
  description: 'd',
  kind: 'hide',
  selectors: [],
  textAnchors: [],
  anchorTarget: 'block',
  ...over,
});

function doc(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('Hider', () => {
  it('counts selector matches once and never re-counts', () => {
    const d = doc('<div class="ai">a</div><div class="ai">b</div>');
    const counts: number[] = [];
    const h = new Hider([rule({ selectors: ['.ai'] })], (_s, _r, n) => counts.push(n));
    expect(h.scan(d)).toBe(1);
    h.scan(d);
    expect(counts.length).toBe(2);
  });

  it('falls back to text anchors when selectors miss, hiding the nearest block', () => {
    const d = doc('<section id="panel"><h2><span>AI Overview</span></h2><p>generated text</p></section><section id="organic"><h3>Result</h3></section>');
    const h = new Hider([rule({ selectors: ['.renamed-class'], textAnchors: ['AI Overview'] })]);
    h.scan(d);
    expect(d.getElementById('panel')!.hasAttribute(HIDDEN_ATTR)).toBe(true);
    expect(d.getElementById('organic')!.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  it('does not run anchors when a selector already matched, or when anchors are throttled', () => {
    const d = doc('<div class="aio">x</div><section id="other"><span>AI Overview</span></section>');
    new Hider([rule({ selectors: ['.aio'], textAnchors: ['AI Overview'] })]).scan(d);
    expect(d.getElementById('other')!.hasAttribute(HIDDEN_ATTR)).toBe(false);
    const d2 = doc('<section id="p"><span>AI Overview</span></section>');
    new Hider([rule({ textAnchors: ['AI Overview'] })]).scan(d2, false);
    expect(d2.getElementById('p')!.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  it('matches controls by text or accessible name, at the start only, with a word boundary', () => {
    const d = doc(`
      <button id="a">Ask AI</button>
      <button id="b" aria-label="Summarize with AI"><svg></svg></button>
      <a id="c" href="/x">Learn how to Ask AI politely in our long blog post about etiquette</a>
      <button id="d">Ask AIs</button>
      <p id="e">Ask AI is a phrase inside a paragraph</p>
      <button id="f">AI Models</button>`);
    new Hider([rule({ textAnchors: ['Ask AI', 'Summarize with AI', 'AI Mode'], anchorTarget: 'control' })]).scan(d);
    const hidden = (id: string) => d.getElementById(id)!.hasAttribute(HIDDEN_ATTR);
    expect(hidden('a')).toBe(true);
    expect(hidden('b')).toBe(true);
    expect(hidden('c')).toBe(false);
    expect(hidden('d')).toBe(false);
    expect(hidden('e')).toBe(false);
    expect(hidden('f')).toBe(false);
  });

  it('never hides the page or its main content', () => {
    const d = doc('<main id="m"><span>AI Overview</span><h1>Title</h1></main>');
    new Hider([rule({ textAnchors: ['AI Overview'], anchorContainer: 'main' })]).scan(d);
    expect(d.getElementById('m')!.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(isUnsafeTarget(d.body)).toBe(true);
  });

  it('survives invalid selectors', () => {
    const d = doc('<div class="ok">x</div>');
    expect(() => new Hider([rule({ selectors: ['div:has(', '.ok'] })]).scan(d)).not.toThrow();
  });

  it('supports hideClosest and remove', () => {
    const d = doc('<li id="row"><a href="/i/grok">Grok</a></li><div id="gone" class="x"></div>');
    new Hider([rule({ selectors: ['a[href="/i/grok"]'], hideClosest: 'li' }), rule({ ruleId: 'r2', kind: 'remove', selectors: ['.x'] })]).scan(d);
    expect(d.getElementById('row')!.getAttribute(HIDDEN_ATTR)).toBe('r');
    expect(d.getElementById('gone')).toBeNull();
  });

  it('reveals everything on teardown', () => {
    const d = doc('<section id="p"><span>AI Overview</span></section>');
    new Hider([rule({ textAnchors: ['AI Overview'] })]).scan(d);
    Hider.revealAll(d);
    expect(d.querySelector(`[${HIDDEN_ATTR}]`)).toBeNull();
  });

  it('anchors are case-insensitive and unicode aware', () => {
    expect(anchorRegex(['Übersicht mit KI']).test('übersicht mit KI')).toBe(true);
    expect(anchorRegex(['AI による概要']).test('AI による概要')).toBe(true);
  });
});
