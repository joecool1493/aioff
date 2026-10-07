// Fill these in as each thing becomes real. Empty means "not available yet", and the pages say so
// in words instead of showing a dead button.
export const STORE_URLS = {
  chrome: 'https://chromewebstore.google.com/detail/ai-off/nkcoofhpdiakekdpbkkmejdnmbpbkjjl',
  edge: 'https://microsoftedge.microsoft.com/addons/detail/ai-off/ijjmejcahkgafngkigkbpljkjfihcimb',
  firefox: 'https://addons.mozilla.org/firefox/addon/aioff/',
  safari: '',
};
/** Published store IDs. The schools policy builder needs them for force-install policy; they match the listing URLs above. */
export const EXTENSION_IDS = {
  chrome: 'nkcoofhpdiakekdpbkkmejdnmbpbkjjl',
  edge: 'ijjmejcahkgafngkigkbpljkjfihcimb',
};
export const CHECKOUT_URLS = {
  pro: '', // Stripe Payment Link or Lemon Squeezy checkout URL for Pro, $19 a year
  lifetime: '', // $39 once
  family: '', // $29 a year
};
export const DESKTOP_URLS = {
  mac: '', // signed, notarized dmg
  windows: '', // signed installer
};
/** Firefox Add-ons listing slug, once the listing is live. Empty means no force-install policy is generated. */
export const AMO_SLUG = 'aioff';
/** True once the license worker has RESEND_API_KEY set and a test key has arrived by email. */
export const EMAIL_DELIVERY_CONFIGURED = false;
/**
 * Paid plans go live only when a checkout URL exists AND email delivery is confirmed, so a buyer
 * who closes the thank-you tab still gets the key. Until then the pricing page shows status text
 * and the thank-you page does not poll for a key.
 */
export const PAID_LIVE = EMAIL_DELIVERY_CONFIGURED && !!(CHECKOUT_URLS.pro || CHECKOUT_URLS.lifetime || CHECKOUT_URLS.family);
/** True once rules.aioff.app/lists serves the published lists (the rules workflow puts them there). */
export const LISTS_PUBLISHED = true;
/** True once config.aioff.app is deployed for schools. */
export const HOSTED_CONFIG_AVAILABLE = false;
export const LICENSE_WORKER = 'https://license.aioff.app';
export const LISTS_BASE = 'https://rules.aioff.app/lists';
export const GITHUB = 'https://github.com/joecool1493/aioff';
export const CONTACT = 'hello@aioff.app';
export const SCHOOLS_CONTACT = 'schools@aioff.app';
export const SCHOOLS_QUOTE = `mailto:${SCHOOLS_CONTACT}?subject=AI%20Off%20for%20Schools%20quote`;
