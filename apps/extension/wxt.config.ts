import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { adapterMatches } from './lib/hosts';

// See DECISIONS.md for why each permission is here. Keep the list minimal.
export default defineConfig({
  // AIOFF_OUT_DIR lets the proof script build into a separate folder so a test build never ships.
  outDir: process.env.AIOFF_OUT_DIR || '.output',
  modules: ['@wxt-dev/module-react'],
  // AMO reviewers rebuild from source, and this extension depends on workspace packages,
  // so the sources zip is rooted at the monorepo. The built packages/rules/dist/rules.json travels
  // with it: its version and generatedAt carry the build date, so a reviewer who rebuilt the rules
  // would get different bytes. With the file included, the reviewer's build matches ours exactly
  // (see BUILD-FIREFOX.md at the repo root).
  zip: {
    sourcesRoot: resolve(import.meta.dirname, '../..'),
    excludeSources: ['research/**', 'packages/core/test/fixtures/**', 'docs/**', 'healthcheck-report/**', 'keys/**', 'apps/site/**', 'apps/companion/**', 'apps/ios/**', 'apps/workers/**', 'packages/rules/fixtures/**', 'apps/site/dist/**', 'packages/dns/dist/**', 'packages/policies/dist/**', 'packages/rules/dist/rules.pretty.json', 'packages/rules/dist/summary.json', 'packages/rules/dist/rules.json.sig', '**/.output/**', '**/.output-*/**', '**/target/**'],
  },
  hooks: {
    // Safari has no storage.managed, so its bundle does not carry the schema file either.
    'build:publicAssets': (wxt, files) => {
      if (wxt.config.browser !== 'safari') return;
      const at = files.findIndex((f) => f.relativeDest === 'managed_schema.json');
      if (at >= 0) files.splice(at, 1);
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      const hosts = adapterMatches();
      for (const cs of manifest.content_scripts ?? []) cs.matches = hosts;
    },
  },
  manifest: ({ browser }) => {
    const hosts = adapterMatches();
    return {
      name: 'AI Off',
      short_name: 'AI Off',
      description:
        'One switch that removes AI features and AI content from the web. Open rules, zero telemetry, and no AI inside.',
      homepage_url: 'https://aioff.app',
      // Minimum versions follow Ed25519 in WebCrypto (Chrome 137, Firefox 130, Safari 17): an older browser could
      // never verify the rules feed and would sit on the embedded rules forever with a permanent signature error.
      // Safari only performs redirects with the host-access variant of the permission, and only on sites the
      // person has granted (both the origin and the destination of the redirect).
      permissions: [
        'storage',
        browser === 'safari' ? 'declarativeNetRequestWithHostAccess' : 'declarativeNetRequest',
        'scripting',
        'activeTab',
        'alarms',
      ],
      // AIOFF_ALL_SITES=1 bakes the optional all-sites access into a test build, because the real-browser checks
      // cannot accept the permission prompt and the Blackout page needs that access. Production builds never set it.
      host_permissions: process.env.AIOFF_ALL_SITES ? [...hosts, '*://*/*'] : hosts,
      optional_host_permissions: ['*://*/*'],
      web_accessible_resources: [{ resources: ['blocked.html'], matches: ['*://*/*'] }],
      ...(browser === 'firefox'
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'aioff@aioff.app',
                strict_min_version: '130.0',
                data_collection_permissions: { required: ['none'] },
              },
              gecko_android: { strict_min_version: '130.0' },
            },
          }
        : browser === 'safari'
          ? // Safari has no storage.managed, so no managed_schema. It reads its minimum version from this key
            // (Apple: "Optimizing your web extension for Safari"); iOS and iPadOS share Safari's version number.
            { browser_specific_settings: { safari: { strict_min_version: '17.0' } } }
          : { storage: { managed_schema: 'managed_schema.json' }, minimum_chrome_version: '137' }),
    };
  },
});
