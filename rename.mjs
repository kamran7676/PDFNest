import fs from 'node:fs';
import path from 'node:path';
const skip = new Set(['node_modules', 'dist', '.astro', '.git', 'package-lock.json', 'rename.mjs']);
function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (skip.has(f.name)) continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(astro|js|mjs|json|md|html)$/.test(f.name)) {
      const s = fs.readFileSync(p, 'utf8');
      const n = s.replace(/PDFForge/g, 'PDFNest').replace(/pdfforge-astro/g, 'pdf-nest').replace(/pdfforge_/g, 'pdfnest_');
      if (n !== s) { fs.writeFileSync(p, n); console.log('updated', p); }
    }
  }
}
walk('.');
