// Payment webhook -> offline license key. Works with Stripe Checkout or Lemon Squeezy (a merchant
// of record, which handles VAT and sales tax for you; see docs/PRICING.md for the tradeoff).
//
//   POST /stripe        Stripe webhook (checkout.session.completed)
//   POST /lemonsqueezy  Lemon Squeezy webhook (order_created)
//   GET  /key?p=stripe&id=cs_...   or   /key?p=ls&id=<order identifier (UUID)>
//        -> {"key": "AIOFF-..."}  used by the site's thank-you page. The id is the receipt id the
//           buyer was just redirected with; it is unguessable and only ever returns that buyer's key.
//           Lemon Squeezy order numbers count up, so the key is filed under the order's UUID
//           ("identifier"), which the checkout passes to the thank-you page as [order_identifier].
//
// The key is also emailed through Resend when RESEND_API_KEY is set. No customer database: the
// payment provider is the system of record, and KV holds only { receipt id -> key } for 1 year.
import { issueLicense, type LicensePayload } from '@aioff/core/license';

interface Env {
  KEYS: KVNamespace;
  LICENSE_PRIVATE_KEY_PKCS8_B64: string;
  PRICE_PLANS: string;
  FROM_EMAIL: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_API_KEY?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
}

const DEVICES: Record<LicensePayload['plan'], number> = { pro: 5, lifetime: 5, family: 10, edu: 0 };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

function hexOf(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexOf(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

async function verifyStripe(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  return constantTimeEqual(await hmacHex(secret, `${parts.t}.${body}`), parts.v1);
}

async function makeKey(env: Env, plan: LicensePayload['plan'], receiptId: string): Promise<string> {
  const issued = new Date();
  const expires = plan === 'lifetime' ? undefined : new Date(issued.getTime() + 366 * 86400_000).toISOString().slice(0, 10);
  const payload: LicensePayload = { id: `L-${receiptId.slice(-12)}`, plan, devices: DEVICES[plan], issued: issued.toISOString().slice(0, 10), ...(expires ? { expires } : {}) };
  const pkcs8 = Uint8Array.from(atob(env.LICENSE_PRIVATE_KEY_PKCS8_B64), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  return issueLicense(payload, privateKey);
}

async function emailKey(env: Env, to: string, key: string, plan: string): Promise<void> {
  if (!env.RESEND_API_KEY || !to) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject: 'Your AI Off Pro key',
      text: `Thanks for buying AI Off Pro (${plan}).\n\nYour license key:\n\n${key}\n\nPaste it into AI Off (Settings, Pro) on each of your devices. It is checked on your device; there is no account and no login.\n\nKeep this email. We do not store your address, so we cannot resend it.\n\nAI Off\nhttps://aioff.app`,
    }),
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (req.method === 'GET' && url.pathname === '/key') {
      const p = url.searchParams.get('p');
      const id = url.searchParams.get('id') ?? '';
      if ((p !== 'stripe' && p !== 'ls') || !/^[A-Za-z0-9_-]{6,120}$/.test(id)) return json({ error: 'bad request' }, 400);
      const key = await env.KEYS.get(`key:${p}:${id}`);
      return key ? json({ key }) : json({ error: 'not ready' }, 404);
    }
    if (req.method !== 'POST') return new Response('AI Off license worker', { status: 200 });
    const body = await req.text();
    const plans = JSON.parse(env.PRICE_PLANS) as Record<string, LicensePayload['plan']>;

    if (url.pathname === '/stripe') {
      if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripe(body, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return json({ error: 'bad signature' }, 400);
      const event = JSON.parse(body) as { type: string; data: { object: { id: string; customer_details?: { email?: string }; metadata?: Record<string, string> } } };
      if (event.type !== 'checkout.session.completed') return json({ ignored: true });
      const session = event.data.object;
      // Payment Links carry the price in line items; fetch them with the restricted key when metadata has no price_id.
      let priceId = session.metadata?.price_id ?? '';
      if (!priceId && env.STRIPE_API_KEY) {
        const li = (await (await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items?limit=1`, { headers: { Authorization: `Bearer ${env.STRIPE_API_KEY}` } })).json()) as { data?: { price?: { id?: string } }[] };
        priceId = li.data?.[0]?.price?.id ?? '';
      }
      const plan = plans[priceId] ?? 'pro';
      const key = await makeKey(env, plan, session.id);
      await env.KEYS.put(`key:stripe:${session.id}`, key, { expirationTtl: 366 * 86400 });
      await emailKey(env, session.customer_details?.email ?? '', key, plan);
      return json({ ok: true });
    }

    if (url.pathname === '/lemonsqueezy') {
      const sig = req.headers.get('X-Signature') ?? '';
      if (!env.LEMONSQUEEZY_WEBHOOK_SECRET || !constantTimeEqual(await hmacHex(env.LEMONSQUEEZY_WEBHOOK_SECRET, body), sig)) return json({ error: 'bad signature' }, 400);
      const event = JSON.parse(body) as { meta: { event_name: string }; data: { id: string; attributes: { identifier?: string; user_email?: string; first_order_item?: { variant_id?: number; product_id?: number } } } };
      if (event.meta.event_name !== 'order_created') return json({ ignored: true });
      const item = event.data.attributes.first_order_item;
      const plan = plans[String(item?.variant_id)] ?? plans[String(item?.product_id)] ?? 'pro';
      const receipt = event.data.attributes.identifier;
      if (!receipt || !/^[A-Za-z0-9_-]{6,120}$/.test(receipt)) return json({ error: 'order has no identifier' }, 400);
      const key = await makeKey(env, plan, receipt);
      await env.KEYS.put(`key:ls:${receipt}`, key, { expirationTtl: 366 * 86400 });
      await emailKey(env, event.data.attributes.user_email ?? '', key, plan);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  },
};
