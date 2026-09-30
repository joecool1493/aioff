// Prints what AI Off's Level 3 scanner sees in an image file. Usage: pnpm tsx tools/scripts/scan-image.ts <file>
import { readFileSync } from 'node:fs';
import { scanProvenance } from '../../packages/core/src/provenance.ts';

for (const file of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(file));
  const r = scanProvenance(bytes);
  console.log(`${file}: verdict=${r.verdict} hasC2pa=${r.hasC2pa} sourceTypes=${r.sourceTypes.join(',') || '(none)'} (${bytes.length} bytes)`);
}
