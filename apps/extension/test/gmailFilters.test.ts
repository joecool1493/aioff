import { describe, expect, it } from 'vitest';
import { gmailFiltersXml, outlookRuleText, subjectQueries } from '../lib/gmailFilters';

describe('Gmail filter export', () => {
  it('splits a long word list into several filters and quotes every term', () => {
    const q = subjectQueries(Array.from({ length: 25 }, (_, i) => `term ${i}`));
    expect(q.length).toBe(3);
    expect(q[0]).toMatch(/^subject:\("term 0" OR "term 1" OR /);
    expect(q[2]).toBe('subject:("term 24")');
  });

  it('keeps the filters to newsletters and escapes the XML', () => {
    const xml = gmailFiltersXml(['AI <slop> & "hype"'], { label: 'Off & <on>' });
    expect(xml).toContain('unsubscribe');
    expect(xml).toContain('&lt;slop&gt; &amp; hype');
    expect(xml).toContain("name='label' value='Off &amp; &lt;on&gt;'");
    expect(xml).toContain("name='shouldArchive' value='true'");
    expect(xml).not.toContain(String.fromCharCode(0x2014));
    expect(gmailFiltersXml(['AI'], { onlyNewsletters: false })).not.toContain('unsubscribe');
  });

  it('gives Outlook a plain list for its one manual rule', () => {
    expect(outlookRuleText(['ChatGPT', 'Copilot'])).toBe('ChatGPT; Copilot');
  });
});
