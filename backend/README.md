# TabTab email

The GitHub Pages site posts to a Cloudflare Worker. D1 is the master contact list;
Resend is only the delivery service. Markdown is rendered by a bundled parser; the dashboard uses no external frontend services.

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
8. Verify `/health` reports `signup_ready: true`; test an immediate signup
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

Default maximum is 80 new messages per invocation. All sends also share the
dashboard’s database quota, reserving 20 of the Free plan’s 100 daily attempts
for confirmations, login codes, and tests. After upgrading Resend, select paid
mode in dashboard Settings and set `TABTAB_SEND_LIMIT` to the desired CLI batch size. The CLI sends at less than two requests/second and stops on
the first error. Running the same campaign again skips successful deliveries.
Content is immutable per recipient/campaign; do not reuse an ID for a different
release. No release is sent automatically on Git pushes.

Uncertain/failed sends are held for manual inspection in the provider log;
there is no blind retry after the provider's idempotency window. After confirming
an email was not accepted, an operator can remove just that delivery row in D1
and rerun. Never reset a delivery whose provider acceptance is unknown.

Website signups activate immediately through the Subscribe action and send no confirmation email. New evidence is labeled `website-single-opt-in`, not verified ownership. Existing pending contacts are not bulk activated. Legacy confirmation links remain supported and require POST; GETs are
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

## Private dashboard

Open **https://updates.tabtabapp.net/dashboard**. Click **Email me a sign-in code**;
enter the 8-digit code sent to `xiaochean@gmail.com`. Codes expire in 10 minutes
and allow five attempts. Dashboard access is restricted to that owner inbox.
Sessions last seven days and use secure, HttpOnly, SameSite cookies. Sign out to
revoke the current session. No admin API key is exposed to browser JavaScript.

- **Subscribers:** search names/emails, filter statuses, inspect source and subscription
  basis, and unsubscribe a contact without deleting their history.
- **Write an update:** Markdown editor with saved drafts, subject, and preview text.
  Headings, links, images, tables, lists, quotes, and code blocks are supported.
  Raw HTML is escaped; links and images are restricted to safe URL schemes.
- **Preview:** the same inline-styled, table-based HTML renderer used for sends,
  in desktop/mobile widths and illustrative Gmail, Apple Mail, or Outlook frames.
  These are **browser approximations**, not actual client screenshots or dark-mode
  emulation. Use **Send test** to view exact rendering in real client inboxes.
- **Settings:** configure a valid mailing address and choose the sending allowance.
  Selecting paid mode does not purchase or upgrade a Resend plan.
- **Send test:** sends only to the address entered. Tests use an inert unsubscribe
  link and a `[TEST]` subject. An exact-content test is required before a campaign
  can start. Editing the message or footer invalidates that test requirement.
- **Review & send:** confirms the subject, snapshots the currently subscribed
  audience, and queues the campaign. Content and footer are frozen when it starts.
  Pause/resume is available; an already in-flight email may finish after pausing.

A Cloudflare Cron Trigger runs each minute, sending up to six emails per invocation
within D1 Free's query limit. The dashboard can be closed while sending continues.
On the default Free configuration, campaign emails stop at 80 total email attempts
in a UTC day, reserving the last 20 of 100 for sign-in, confirmation, and test emails.
The campaign resumes after the UTC day changes. Paid mode caps attempts at 5,000/day;
a list of roughly 2,300 recipients takes about 6.5 hours with this background rate.
All sending entrypoints share the database quota, including the original CLI.
Provider monthly limits still apply. Uncertain provider outcomes pause the campaign
for review; they are never blindly retried. Each recipient's status is checked again
before delivery, so later opt-outs are honored.

The dashboard stores drafts, audience snapshots, login-code hashes, session hashes,
and usage totals in D1. It adds one bundled Markdown parser (`marked`), no external
frontend/CDN dependencies, and no new third-party service. No customer campaign was
sent as part of dashboard setup.

## Invisible signup protection

The website uses a separate Invisible Cloudflare Turnstile widget for tabtabapp.net.
The public site key is bundled in the signup form; TURNSTILE_SECRET is a Worker secret.
The Subscribe click waits for a background token without further user interaction.
The Worker validates the token, hostname, and signup action before storing a contact.
Missing, expired, reused, or invalid tokens fail closed. Rate limiting and the honeypot remain.
For local browser tests, override PUBLIC_TURNSTILE_SITE_KEY with Cloudflare's test key
and use its corresponding test secret in a local Worker only; never deploy test credentials.
