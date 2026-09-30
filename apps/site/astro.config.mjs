import { defineConfig } from 'astro/config';

// Static output. No analytics, no third-party scripts, no fonts from a CDN.
export default defineConfig({
  site: 'https://aioff.app',
  build: { inlineStylesheets: 'always' },
  // Version 2 of the design folded Phone into Devices and Network lists into Download.
  redirects: {
    '/phone/': '/computer/#phone',
    '/network/': '/download/#network',
  },
  vite: { server: { fs: { allow: ['../..'] } } },
});
