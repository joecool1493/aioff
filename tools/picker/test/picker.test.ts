import { describe, expect, it } from 'vitest';
import { buildIssueUrl, generateSelectors, looksGenerated, textAnchorFor } from '../src/index.ts';

describe('selector generator', () => {
  it('prefers stable ids, then data attributes, then aria', () => {
    document.body.innerHTML = `
      <div id="nav-rufus-disco"><span>Rufus</span></div>
      <button data-testid="GrokDrawer" class="css-1dbjc4n r-1awozwy"></button>
      <button aria-label="Ask Gemini" class="Zmxtcf"></button>`;
    expect(generateSelectors(document.getElementById('nav-rufus-disco')!).best).toBe('#nav-rufus-disco');
    expect(generateSelectors(document.querySelector('[data-testid]')!).best).toBe('button[data-testid="GrokDrawer"]');
    expect(generateSelectors(document.querySelector('[aria-label]')!).best).toBe('button[aria-label="Ask Gemini"]');
  });
  it('ignores generated ids and classes', () => {
    expect(looksGenerated(':r1a:')).toBe(true);
    expect(looksGenerated('css-1dbjc4n')).toBe(true);
    expect(looksGenerated('x1lliihq')).toBe(true);
    expect(looksGenerated('ember1234567')).toBe(true);
    expect(looksGenerated('nav-rufus-disco')).toBe(false);
    expect(looksGenerated('search')).toBe(false);
  });
  it('uses custom element names and falls back to a structural path that matches exactly one element', () => {
    document.body.innerHTML = '<main><yt-ask-panel></yt-ask-panel><ul><li><span>one</span></li><li><span>two</span></li></ul></main>';
    expect(generateSelectors(document.querySelector('yt-ask-panel')!).best).toBe('yt-ask-panel');
    const second = document.querySelectorAll('span')[1]!;
    const { best } = generateSelectors(second);
    expect(document.querySelectorAll(best).length).toBe(1);
    expect(document.querySelector(best)).toBe(second);
    expect(best).toContain(':nth-of-type(2)');
  });
  it('narrows a repeated local selector with a stable ancestor', () => {
    document.body.innerHTML = '<div id="sidebar"><button aria-label="Ask AI"></button></div><div id="footer-tools"><button aria-label="Ask AI"></button></div>';
    const target = document.querySelector('#footer-tools button')!;
    const { best } = generateSelectors(target);
    expect(document.querySelector(best)).toBe(target);
    expect(document.querySelectorAll(best).length).toBe(1);
  });
  it('offers a short text anchor', () => {
    document.body.innerHTML = '<button>Summarize with AI for me right now please</button>';
    expect(textAnchorFor(document.querySelector('button')!)).toBe('Summarize with AI for');
  });
  it('builds an issue URL that strips the query string and sends nothing by itself', () => {
    document.body.innerHTML = '<button id="ask-ai">Ask AI</button>';
    const url = new URL(
      buildIssueUrl({ repo: 'aioff-app/off-rules', pageUrl: 'https://shop.example.com/cart?session=SECRET#frag', result: generateSelectors(document.getElementById('ask-ai')!), extensionVersion: '0.1.0' }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/aioff-app/off-rules/issues/new');
    const body = url.searchParams.get('body')!;
    expect(body).toContain('https://shop.example.com/cart');
    expect(body).not.toContain('SECRET');
    expect(body).toContain('#ask-ai');
  });
});
