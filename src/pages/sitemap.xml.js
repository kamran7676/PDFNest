import tools from '../data/tools.json';
import articles from '../../content/articles.mjs';

export function GET({ site }) {
  const base = site.origin;
  const urls = [['/', '1.0'], ['/blog/', '0.6'],
    ...tools.map((t) => [`/${t.slug}/`, '0.9']),
    ...articles.map((a) => [`/blog/${a.slug}/`, '0.7'])];
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    urls.map(([u, p]) => `<url><loc>${base}${u}</loc><priority>${p}</priority></url>`).join('') + `</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
