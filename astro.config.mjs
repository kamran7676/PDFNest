import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://example.com');

export default defineConfig({
  site,
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});

