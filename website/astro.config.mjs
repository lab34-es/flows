// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Deployed to GitHub Pages at the custom domain https://flows.lab34.es/
// (public/CNAME + the Pages custom-domain setting in the repository).
export default defineConfig({
  site: 'https://flows.lab34.es',
  trailingSlash: 'always',
  integrations: [sitemap()],
  // Articles merged into others when the docs were restructured around the
  // concepts. The old addresses keep working, for bookmarks and search engines.
  redirects: {
    '/docs/flow-anatomy': '/docs/concepts/',
    '/docs/where-things-live': '/docs/context/',
    '/docs/ui-tour': '/docs/flows/',
    '/docs/editing': '/docs/flows/',
    '/docs/markdown': '/docs/flows/',
    '/docs/properties': '/docs/flows/',
    '/docs/folder-views': '/docs/organizing/',
    '/docs/mimic': '/docs/step-blocks/',
    '/docs/running': '/docs/test-runs/',
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: {
        // The docs content is imported straight from the app's Help section,
        // which lives outside this Vite root (../frontend).
        allow: ['..'],
      },
    },
  },
});
