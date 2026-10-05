export function GET({ site }) {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${site.origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
}
