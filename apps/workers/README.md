# Workers

Three tiny Cloudflare Workers. None is needed for the free extension. None ever sees browsing data, a passphrase, or a plaintext setting.

| Worker | What it does | Holds |
|---|---|---|
| `license` | Payment webhook (Stripe or Lemon Squeezy) in, Ed25519-signed license key out. Serves the key to the thank-you page by receipt id and emails it through Resend if configured. | The signing key, and `{receipt id -> key}` in KV for a year. No customer database. |
| `sync` | Stores an encrypted settings blob per Pro user in R2, keyed by an id derived from their passphrase. Requires a valid Pro license on every call. | Ciphertext only. |
| `edu-config` | Serves a school's signed org config and lets an admin flip Exam Mode without waiting for Google Admin to propagate. | One small JSON document per org in KV. No student data. |

Deploy each with `npx wrangler deploy` from its folder after filling in `wrangler.toml` and setting the secrets listed at the top of each `wrangler.toml`. They typecheck against the Workers runtime types; none has been run against a live account yet.

Custom domains (Cloudflare dashboard, Workers, Triggers): `license.aioff.app`, `sync.aioff.app`, `config.aioff.app`.
