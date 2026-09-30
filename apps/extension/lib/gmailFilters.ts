// Email cleanup without OAuth and without driving the Gmail UI: Gmail can import filters
// from an XML file (Settings, Filters and Blocked Addresses, Import filters). We generate
// that file locally. The user reviews every filter in Gmail before it is created.

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Gmail search syntax: subject:("term one" OR "term two"). Chunked so no query gets too long. */
export function subjectQueries(terms: string[], chunkSize = 12): string[] {
  const quoted = terms.map((t) => `"${t.replace(/"/g, '')}"`);
  const out: string[] = [];
  for (let i = 0; i < quoted.length; i += chunkSize) out.push(`subject:(${quoted.slice(i, i + chunkSize).join(' OR ')})`);
  return out;
}

export function gmailFiltersXml(terms: string[], opts: { label?: string; onlyNewsletters?: boolean } = {}): string {
  const label = opts.label ?? 'AI Off';
  const now = new Date().toISOString();
  const entries = subjectQueries(terms).map((q, i) => {
    // "unsubscribe" limits the filter to newsletters and marketing mail, never personal mail.
    const query = opts.onlyNewsletters === false ? q : `${q} unsubscribe`;
    return `  <entry>
    <category term='filter'></category>
    <title>Mail Filter</title>
    <id>tag:mail.google.com,2008:filter:aioff${i}</id>
    <updated>${now}</updated>
    <content></content>
    <apps:property name='hasTheWord' value='${xmlEscape(query)}'/>
    <apps:property name='label' value='${xmlEscape(label)}'/>
    <apps:property name='shouldArchive' value='true'/>
    <apps:property name='shouldNeverMarkAsImportant' value='true'/>
  </entry>`;
  });
  return `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
  <title>Mail Filters</title>
${entries.join('\n')}
</feed>
`;
}

/** Outlook has no filter import. This is the text for one Rule the user creates by hand. */
export function outlookRuleText(terms: string[]): string {
  return terms.join('; ');
}
