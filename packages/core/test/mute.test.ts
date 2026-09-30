import { describe, expect, it } from 'vitest';
import { compileTerms, effectiveTerms, findAiAdSlots, isCaseSensitiveTerm, MUTED_ATTR, Muter, SHOWN_ATTR, type MuteConfig } from '../src/index.ts';

describe('term matching', () => {
  const m = compileTerms(['AI', 'A.I.', 'LLM', 'artificial intelligence', 'ChatGPT', 'Claude', 'vibe coding'], ['Allen Iverson', 'Claude Monet', 'Ai Weiwei']);
  it('matches short all-caps tokens case-sensitively on word boundaries', () => {
    expect(m.find('New AI model released')).toBe('AI');
    expect(m.find('She said the aid was fair')).toBeNull();
    expect(m.find('Visit Ai Weiwei exhibit')).toBeNull();
    expect(m.find('MAIL and RAID and AIR')).toBeNull();
    expect(m.find('"AI," she wrote')).toBe('AI');
    expect(m.find('The A.I. boom')).toBe('A.I.');
    expect(m.find('an llm is')).toBeNull();
    expect(isCaseSensitiveTerm('AI')).toBe(true);
    expect(isCaseSensitiveTerm('ChatGPT')).toBe(false);
  });
  it('matches longer terms case-insensitively', () => {
    expect(m.find('I asked chatgpt about it')).toBe('chatgpt');
    expect(m.find('ARTIFICIAL INTELLIGENCE is here')).toBe('ARTIFICIAL INTELLIGENCE');
    expect(m.find('Vibe coding my weekend away')).toBe('Vibe coding');
  });
  it('honors exclusions', () => {
    expect(m.find('A Claude Monet retrospective')).toBeNull();
    expect(m.find('Claude Monet vs Claude the chatbot')).toBe('Claude');
  });
  it('merges user words and lets the user drop feed words', () => {
    const cfg = { terms: ['AI', 'Gemini'] } as MuteConfig;
    expect(effectiveTerms(cfg, ['blockchain'], ['gemini'])).toEqual(['AI', 'blockchain']);
  });
});

describe('Muter', () => {
  it('collapses matching containers without inserting nodes, and reveals on click', () => {
    document.body.innerHTML = '<article id="a"><p>OpenAI ships new AI model</p></article><article id="b"><p>Local bakery wins award</p></article>';
    const before = document.body.innerHTML.length;
    const muter = new Muter({ containers: ['article'], matcher: compileTerms(['AI', 'OpenAI']) });
    expect(muter.scan(document)).toBe(1);
    const a = document.getElementById('a')!;
    expect(a.getAttribute(MUTED_ATTR)).toBe('AI'); // case-sensitive short tokens are tested first
    expect(document.getElementById('b')!.hasAttribute(MUTED_ATTR)).toBe(false);
    expect(document.querySelectorAll('article').length).toBe(2);
    expect(document.body.querySelectorAll('*').length).toBe(4); // no nodes inserted
    expect(before).toBeGreaterThan(0);

    const ev = new Event('click', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'target', { value: a.firstElementChild });
    Muter.handleClick(ev);
    expect(a.hasAttribute(SHOWN_ATTR)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(muter.scan(document)).toBe(0); // shown items stay shown
  });

  it('restricts matching to a text selector and mutes sibling rows', () => {
    document.body.innerHTML = `<table><tbody>
      <tr class="athing" id="t"><td><span class="titleline">Show HN: my LLM toy</span></td></tr><tr id="sub"><td>42 points</td></tr>
      <tr class="athing" id="u"><td><span class="titleline">A post about gardening</span><span class="site">llm.dev</span></td></tr><tr><td>1 point</td></tr>
    </tbody></table>`;
    new Muter({ containers: [{ selector: 'tr.athing', text: '.titleline', nextSiblings: 1 }], matcher: compileTerms(['LLM']) }).scan(document);
    expect(document.getElementById('t')!.hasAttribute(MUTED_ATTR)).toBe(true);
    expect(document.getElementById('sub')!.hasAttribute('data-aioff-sibling')).toBe(true);
    expect(document.getElementById('u')!.hasAttribute(MUTED_ATTR)).toBe(false);
  });

  it('headline mode only looks at headlines', () => {
    document.body.innerHTML = '<article id="a"><h2>City council meets</h2><p>They discussed AI briefly.</p></article><article id="b"><h2>AI takes over council</h2></article>';
    new Muter({ containers: ['article'], matcher: compileTerms(['AI']), headlineSelectors: ['h2'] }).scan(document);
    expect(document.getElementById('a')!.hasAttribute(MUTED_ATTR)).toBe(false);
    expect(document.getElementById('b')!.hasAttribute(MUTED_ATTR)).toBe(true);
  });

  it('revealAll restores the page', () => {
    document.body.innerHTML = '<article><p>ChatGPT</p></article>';
    new Muter({ containers: ['article'], matcher: compileTerms(['ChatGPT']) }).scan(document);
    Muter.revealAll(document);
    expect(document.querySelector(`[${MUTED_ATTR}]`)).toBeNull();
    expect(document.querySelector('[title]')).toBeNull();
  });
});

describe('AI ad slots', () => {
  it('flags slots by landing domain or by text', () => {
    document.body.innerHTML = `
      <div class="ad" id="a"><a href="https://www.jasper.ai/?utm=x">Write faster</a></div>
      <div class="ad" id="b"><a href="https://shoes.example/">Supercharge your workflow with AI agents</a></div>
      <div class="ad" id="c"><a href="https://shoes.example/">Buy shoes</a></div>`;
    const hits = findAiAdSlots(document, ['.ad'], ['jasper.ai'], compileTerms(['AI agents']));
    expect(hits.map((h) => h.el.id)).toEqual(['a', 'b']);
  });
});
