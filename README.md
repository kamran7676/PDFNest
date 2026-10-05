# PDFNest (Astro)

Static Astro site: each tool has its own URL (`/merge-pdf/`, `/protect-pdf/` ...) with its own title, description, FAQ and JSON-LD. Tool logic runs in the browser (`public/app.js`). AI tools call the serverless `api/gemini.js`.

## Env vars (Vercel -> Settings -> Environment Variables)
- `GEMINI_API_KEY` (required for AI tools; server only)
- `SITE_URL` e.g. `https://yourdomain.com` (canonical links, sitemap, and the API Origin allow-list)
- `GEMINI_MODEL` (optional, default `gemini-2.5-flash`)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (recommended: persistent per-IP rate limit; without them an in-memory limit is used)
- `ALLOWED_ORIGINS` (optional, comma separated extra domains, e.g. www version)

## Commands
- `npm install`
- `npm run dev` - site only (AI endpoint not served); use `npx vercel dev` to test AI locally
- `npm run build` - outputs `dist/` (sitemap.xml and robots.txt included)

## Adding things
- New tool: add it in `public/app.js`, then add a matching entry to `src/data/tools.json` (`id`, `name`, `category`, `description`, `slug` = lowercase-hyphen name). The page, sitemap entry and slug map are generated automatically.
- New article: add an entry in `content/articles.mjs` (`slug`, `date`, `tool` = tool id).
