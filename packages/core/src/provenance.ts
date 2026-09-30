// Level 3 provenance reader. Reads declared metadata only: the IPTC digital source
// type inside C2PA manifests (JUMBF/CBOR) and XMP packets. It is a byte scanner, not
// a classifier: if a file does not declare that it is AI generated, this returns "none".
// No model, no heuristics about pixels. It does not validate C2PA signatures, because a
// forged "this is AI" label is harmless for a filter whose only action is hiding.

export type ProvenanceVerdict = 'generated' | 'edited' | 'none';

export interface ProvenanceResult {
  verdict: ProvenanceVerdict;
  hasC2pa: boolean;
  sourceTypes: string[];
}

// algorithmicMedia (procedural, no training data) is deliberately ignored.
export const DEFAULT_GENERATIVE_TYPES = ['trainedAlgorithmicMedia'];
export const DEFAULT_EDITED_TYPES = ['compositeWithTrainedAlgorithmicMedia', 'compositeSynthetic', 'virtualRecording'];

const latin1 = new TextDecoder('latin1');

/** IPTC NewsCodes digital source types, longest first so a prefix never wins. */
const IPTC_TERMS = [
  'compositeWithTrainedAlgorithmicMedia',
  'trainedAlgorithmicMedia',
  'trainedAlgorithmicData',
  'algorithmicallyEnhanced',
  'computationalCapture',
  'compositeSynthetic',
  'compositeCapture',
  'minorHumanEdits',
  'virtualRecording',
  'algorithmicMedia',
  'dataDrivenMedia',
  'digitalCapture',
  'digitalCreation',
  'screenCapture',
  'softwareImage',
  'negativeFilm',
  'positiveFilm',
  'humanEdits',
  'digitalArt',
  'composite',
  'print',
];
const SOURCE_TYPE_RE = new RegExp(`digitalsourcetype/(${IPTC_TERMS.join('|')})`, 'gi');

/** Reassemble JUMBF payloads spread across JPEG APP11 segments so strings never straddle a boundary. */
export function jpegApp11Payload(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // start of scan or end of image
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2) break;
    if (marker === 0xeb && len > 10) {
      const start = i + 4;
      // CI "JP" (2) + En (2) + Z (4), then LBox + TBox (8) repeated in every segment
      if (bytes[start] === 0x4a && bytes[start + 1] === 0x50) {
        const z = (bytes[start + 4]! << 24) | (bytes[start + 5]! << 16) | (bytes[start + 6]! << 8) | bytes[start + 7]!;
        const skip = z > 1 ? 16 : 8;
        parts.push(bytes.subarray(start + skip, i + 2 + len));
      }
    }
    i += 2 + len;
  }
  if (!parts.length) return null;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function scanProvenance(
  bytes: Uint8Array,
  generativeTypes: string[] = DEFAULT_GENERATIVE_TYPES,
  editedTypes: string[] = DEFAULT_EDITED_TYPES,
): ProvenanceResult {
  let text = latin1.decode(bytes);
  const app11 = jpegApp11Payload(bytes);
  if (app11) text += '\n' + latin1.decode(app11);

  const hasC2pa = /c2pa\.(?:claim|assertions|signature|actions)|urn:(?:uuid|c2pa):/.test(text) && /jumb|c2pa/.test(text);
  // Match the IPTC terms exactly: CBOR runs the next key straight after the value, so a greedy
  // [A-Za-z]+ reads "trainedAlgorithmicMediahmetadata" in real files.
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = SOURCE_TYPE_RE.exec(text))) found.add(m[1]!);
  SOURCE_TYPE_RE.lastIndex = 0;

  // Legacy Adobe assertion used by older Firefly files, before digitalSourceType was common.
  if (text.includes('com.adobe.generative-ai')) found.add('trainedAlgorithmicMedia');

  const sourceTypes = [...found];
  const lower = (list: string[]) => list.map((s) => s.toLowerCase());
  const gen = lower(generativeTypes);
  const edit = lower(editedTypes);
  // A byte scan cannot tell the active manifest from an ingredient manifest. A composite term
  // describes the asset as a whole (a photo with an AI-filled region); the generative term next to
  // it is usually the ingredient. So "edited" wins when both appear, and only a file that declares
  // trainedAlgorithmicMedia with no composite term is treated as generated. Hide less, never more.
  let verdict: ProvenanceVerdict = 'none';
  if (sourceTypes.some((t) => edit.includes(t.toLowerCase()))) verdict = 'edited';
  else if (sourceTypes.some((t) => gen.includes(t.toLowerCase()))) verdict = 'generated';
  return { verdict, hasC2pa, sourceTypes };
}

/** uBlacklist style rule lines: match patterns, /regex/, "@" prefix for unblock, "#" comments. */
export interface BlacklistMatcher {
  blocks(url: string): boolean;
  size: number;
}

export function compileBlacklist(lines: string[]): BlacklistMatcher {
  const hostsExact = new Set<string>();
  const hostsWild = new Set<string>();
  const regexes: RegExp[] = [];
  const allowHosts = new Set<string>();
  for (const raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let allow = false;
    if (line.startsWith('@')) {
      allow = true;
      line = line.slice(1).trim();
    }
    // uBlacklist highlight rules ("@1 pattern") and title matchers are ignored.
    if (/^\d+\s/.test(line)) continue;
    if (line.startsWith('/') && line.lastIndexOf('/') > 0) {
      const end = line.lastIndexOf('/');
      try {
        if (!allow) regexes.push(new RegExp(line.slice(1, end), line.slice(end + 1).replace(/[^imsu]/g, '')));
      } catch {
        /* skip bad regex */
      }
      continue;
    }
    const mp = /^(?:\*|https?):\/\/(\*\.)?([^/*]+)\/\*?$/.exec(line);
    let host: string | null = null;
    let wild = false;
    if (mp) {
      host = mp[2]!;
      wild = !!mp[1];
    } else if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(line)) {
      host = line; // plain domain list
      wild = true;
    } else if (/^(0\.0\.0\.0|127\.0\.0\.1)\s+\S+$/.test(line)) {
      host = line.split(/\s+/)[1]!; // hosts file
      wild = true;
    }
    if (!host) continue;
    host = host.toLowerCase();
    if (allow) allowHosts.add(host);
    else (wild ? hostsWild : hostsExact).add(host);
  }
  return {
    size: hostsExact.size + hostsWild.size + regexes.length,
    blocks(url: string): boolean {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return false;
      }
      const host = u.hostname.toLowerCase();
      const labels = host.split('.');
      const suffixes: string[] = [];
      for (let i = 0; i < labels.length - 1; i++) suffixes.push(labels.slice(i).join('.'));
      if (suffixes.some((s) => allowHosts.has(s))) return false;
      if (hostsExact.has(host)) return true;
      if (suffixes.some((s) => hostsWild.has(s))) return true;
      return regexes.some((r) => r.test(url));
    },
  };
}
