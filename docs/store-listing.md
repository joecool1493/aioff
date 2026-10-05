# Store listing copy

Ready to paste. Product only: no maker paragraph. Wording follows store policy: the single purpose is stated exactly, and the verbs are "hide", "remove", and "block". Never "bypass" or "circumvent" (a 2026 Chrome Web Store rule bans circumventing AI-service safeguards; AI Off does not do that and the copy should not suggest it).

## Name
AI Off

## Short description (exactly 132 characters)
Hide unwanted AI features and mute AI talk in your browser. Free, open rules, no AI inside. See what stays. Turn it back on anytime.

## Single purpose (Chrome Web Store)
Remove AI features and AI content from the web.

## Full description (300 words)

AI Off hides AI features added to the websites you use. Keep the page. Put the prompts, sidebars, and summaries out of the way.

The extension is free forever. It is the whole browser product, with no account and no trial timer.

Choose from four levels:

1. Hide AI features. Remove supported AI Overviews, writing prompts, sidebars, and other AI controls inside web pages.

2. Quiet the AI conversation. Also collapse posts, headlines, videos, and ads that match the AI word list into a gray bar. Click Show to read one.

3. Hide AI-made content. Also hide images that declare AI generation, known AI content farms, and posts the platform labels as AI-made. This uses labels and lists. It cannot identify every piece of AI content.

4. Blackout. Also block listed AI services in the browser, including chatbots and generators. Choose this level deliberately. Levels 1 to 3 leave chatbots alone.

Every decision comes from a readable rule, word list, selector, domain list, or label. AI Off contains no AI. It does not detect, judge, or learn.

Pause on a site, pause for 15 minutes, or flip the switch back. Use the element picker for your own rules. Review a GitHub report before choosing to submit it.

There is no telemetry. Signed rules update without an extension release. Level 3 may also fetch lists and image files to read labels. Optional services make additional requests, all listed on our privacy page.

The code and rules are MIT licensed. The desktop companion is separate; this extension does not change operating system settings or built-in phone AI.

Blackout blocks AI tools you may use. It is optional. School policy may lock controls. Rules can miss targets. Pause filtering if a page looks wrong.

Your browser should leave room for what you opened.

Store fields: privacy policy `https://aioff.app/privacy/`, support `mailto:hello@aioff.app`. Do not add review counts, platform-wide coverage claims, or desktop features to the extension's feature list.

## Permission justifications

| Permission | Why |
|---|---|
| storage | Saves your settings and local counters (how many things each rule hid per day). Nothing is sent anywhere. |
| declarativeNetRequest | Asks search engines for AI-free result pages (for example, Google's Web view) and blocks AI companies' ad and tracking hosts. At Level 4 only, blocks AI product sites. |
| scripting | Injects the stylesheet that hides AI elements so they never paint, and starts the element picker when you ask for it. |
| activeTab | Lets the element picker run on the page you are looking at, only when you click it. |
| alarms | Checks for a newer signed rules feed every 6 hours. |
| Host permissions (listed sites) | The sites AI Off has rules for. It needs page access there to hide AI elements. |
| Optional: all sites | Requested only if you choose Level 2 or higher, or turn on generic rules. Needed to hide "Ask AI" buttons and AI chat widgets on any site, and to mute AI headlines on news sites. You can decline and AI Off keeps working on its built-in site list. |

## Remote code
No. AI Off downloads a signed JSON data file of CSS selectors, words, and domains. All logic ships inside the extension package. The feed cannot add or run code.

## Data usage (privacy practices form)
Collects no user data. Not sold, not transferred, not used for creditworthiness or unrelated purposes. Firefox: `data_collection_permissions: none`.

## Screenshots (1280x800, real captures, in `docs/store/`)
- `00-before-after.png`: the same Bing search with AI on and AI off, side by side.
- `01-bing-before.png`, `02-bing-after.png`: the raw pair.
- `03-hn-level2.png`: Level 2 on Hacker News, collapsed gray bars.
- `04-popup-over-bing.png`: the popup, switch in the OFF position, over the cleaned page.
- `05-options-rules.png`: the Rules tab, "why is this hidden" expanded.
- `06-promo-tile-440x280.png`: the small promotional tile the Chrome Web Store requires (drawn by `tools/scripts/store-images.py`, same colors as the site).
- `08-google-before.png`, `09-google-after.png`, `10-google-before-after.png`: the same Google search ("why is the sky blue") with the AI Overview present and then gone, real captures from 2026-10-05. Use `10` as the first screenshot wherever a store allows a change.
Regenerate any time with `pnpm --filter @aioff/healthcheck screenshots` after `pnpm ext:build`. The Google set comes from `tools/healthcheck/src/google-shots.ts`, which runs a headed browser because Google blocks headless ones; its header says how to run it. The same script records the short demo clip.
