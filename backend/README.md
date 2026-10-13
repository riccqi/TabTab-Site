# TabTab email

The GitHub Pages site posts to a Cloudflare Worker. D1 is the master contact list;
Resend is only the delivery service. There are no runtime npm dependencies.

## Deployment checklist

1. Authenticate with `npx wrangler login` and create the database:
   `npx wrangler d1 create tabtab-email --config backend/wrangler.jsonc`.
2. Put the returned ID in `backend/wrangler.jsonc`. Set the Lemon Squeezy store ID
   and the comma-separated TabTab product IDs. Set the sender, reply address,
   and your business mailing address (`POSTAL_ADDRESS`, needed before releases).
3. Run `npm run email:migrate`.
4. Create the Worker with `npm run email:deploy`. Add `updates.tabtabapp.net` as
   its custom domain. This does not move the website off GitHub Pages.
5. Add Worker secrets using `npx wrangler secret put NAME --config backend/wrangler.jsonc`:
   - `TOKEN_SECRET`: at least 32 random bytes; retain securely. Rotating it
     invalidates old unsubscribe links, so do not rotate casually.
   - `ADMIN_TOKEN`: a separate random secret for import/export and release sends.
   - `LEMONSQUEEZY_WEBHOOK_SECRET`: the same signing secret entered in Lemon Squeezy.
   - `RESEND_API_KEY`: a sending-only Resend key restricted to the verified domain.
   - `RESEND_WEBHOOK_SECRET`: the signing secret for the Resend webhook below.
6. In Resend, verify `tabtabapp.net` using the displayed DNS records. Do not replace
   unrelated existing MX/SPF records. Configure the webhook
   `https://updates.tabtabapp.net/webhooks/resend` for `email.bounced`,
   `email.complained`, and `email.suppressed`.
7. In Lemon Squeezy (live mode), create a webhook to
   `https://updates.tabtabapp.net/webhooks/lemonsqueezy`, event `order_created`.
   Test with a signed fixture and check D1; test-mode orders are intentionally ignored.
8. Verify `/health` reports `signup_ready: true`; test a signup and confirmation
   with your own address, then unsubscribe. **Do not publish the changed website
   until the backend and verified sending domain work.** The live Formspree form
   continues working until the site changes are published.
9. Import contacts as below, then publish the site. Take another Formspree export
   after cutover to catch submissions that arrived during migration.

The public signup endpoint is configured in `EmailSignup.astro`; optionally set
`PUBLIC_EMAIL_ENDPOINT` at build time. For local testing set `SITE_ORIGIN` to the
local Astro origin and `PUBLIC_URL` to the local Worker URL in `.dev.vars`.
Never put API keys or subscriber files in `public/`, `src/`, or Git.

## Migration

The private working files live in `.private/`, which is ignored by Git. Import
records are JSON objects with `email`, optional `name`, `source`, `external_id`,
and `status`. Sources are `website`, `formspree`, `lemonsqueezy`, or `manual`.

- Confirmed `subscribed` imports need `consent_at`, `consent_source`, and preferably `consent_version`. Lemon Squeezy legacy subscribers may instead have `subscription_basis: legacy_provider_subscription`, preserving their prior status without inventing an opt-in timestamp.
- `customer` stores a buyer without assuming marketing consent.
- `unsubscribed` and `suppressed` override subscribed imports in either import order.
- Existing source records remain attached when emails deduplicate.
- Keep plus addressing and dots unchanged; only trim whitespace and lowercase.

Load `TABTAB_ADMIN_TOKEN` securely into your shell environment. It is never a
command-line argument. `TABTAB_EMAIL_URL` defaults to `https://updates.tabtabapp.net`.

```sh
node backend/scripts/contacts.mjs import .private/formspree-import.json
node backend/scripts/contacts.mjs import .private/formspree-import.json --apply
node backend/scripts/contacts.mjs import .private/lemonsqueezy-import.json --apply
node backend/scripts/contacts.mjs export .private/contacts-backup.json
```

The import validates all rows before starting, uses batches of 25, and is safe to
repeat. It sends no email. Exports are private JSON with mode 0600 and refuse to
overwrite an existing file. Full database backup including sources and deliveries:

```sh
npx wrangler d1 export tabtab-email --config backend/wrangler.jsonc --remote --output=.private/database-backup.sql
```

The owner requested preservation of Lemon Squeezy's existing subscriber status on 2026-10-13. These records use `subscription_basis=legacy_provider_subscription`; this is not proof of explicit opt-in, and their consent timestamp remains unknown. Formspree signup evidence is retained separately. Invalid addresses and opt-outs always win.

## New purchases

`order_created` webhooks are HMAC-SHA256 verified against the raw body. Only paid,
live-mode orders for the configured store and product IDs are accepted. Order IDs
deduplicate retries, and D1 writes are transactional. An existing unsubscribe
cannot be undone by a purchase. The owner enabled `LEMONSQUEEZY_CUSTOMER_UPDATES=true`: new buyers are eligible for customer release updates, with `subscription_basis=customer_release_updates` and no invented explicit-consent timestamp. Set this variable to `false` to record new buyers as `customer` instead. Migrating payment systems
later only requires another importer/webhook that writes to this same table.

The filter uses the order's `first_order_item.product_id`, matching the current
single-product TabTab checkout. Revisit it before enabling multi-product carts.

## Sending a release

Create a private JSON file with `campaign_id` (e.g. `tabtab-2.4.0`), `subject`, and
plain `text`. The backend adds a visible unsubscribe link, one-click unsubscribe
headers, and your mailing address. Preview with a dry run:

```sh
node backend/scripts/contacts.mjs release .private/release.json
# After reviewing the content and audience:
node backend/scripts/contacts.mjs release .private/release.json --send
```

Default maximum is 80 new messages per invocation, leaving some room on Resend's
free 100/day plan for confirmations. **This is not a daily quota controller:**
check total provider usage before sending. On Pro set `TABTAB_SEND_LIMIT` to the
desired batch size. The CLI sends at less than two requests/second and stops on
the first error. Running the same campaign again skips successful deliveries.
Content is immutable per recipient/campaign; do not reuse an ID for a different
release. No release is sent automatically on Git pushes.

Uncertain/failed sends are held for manual inspection in the provider log;
there is no blind retry after the provider's idempotency window. After confirming
an email was not accepted, an operator can remove just that delivery row in D1
and rerun. Never reset a delivery whose provider acceptance is unknown.

Confirmations use expiring signed links and require POST to activate; GETs are
safe for mail scanners. Unsubscribe links do not expire and POST works for mail
clients' one-click unsubscribe. Hard delivery failures and complaints suppress
the address through a signed Resend webhook.

## Checks

`npm run verify` includes SQLite-backed backend tests, Astro checks, the build,
and route validation. `npx wrangler deploy --config backend/wrangler.jsonc
--dry-run` checks the Worker bundle. Actual DNS, webhook delivery, inbox delivery,
and public signup must also be verified before cutover.

## Live configuration (2026-10-13)

Worker: `https://updates.tabtabapp.net`. D1: `tabtab-email`. Resend domain: `tabtabapp.net` (verified), sending-only domain-restricted key stored in Worker secrets. Lemon Squeezy store: `125728`, product: `372705`. Both signed webhooks are registered. Private secrets are in ignored `backend/.secrets.json` (0600); never commit this file. Release sending still requires a valid `POSTAL_ADDRESS`. No release campaign has been sent.
