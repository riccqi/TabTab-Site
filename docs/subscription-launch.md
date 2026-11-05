# TabTab direct-download and pricing website release

Offer for new customers: download first with a 7-day local trial (no account or card,
no automatic charge when it ends), or buy directly. US$4.99/month, US$34.99/year (Annual,
selected by default) or US$99.99 once (Lifetime, including future updates). Every paid
plan covers 3 Macs.

Existing customers keep what they have. Polar trial customers retain their original trial
expiry, issued licenses and billing schedule, and are not moved onto a local trial or asked
to repurchase. Lemon Squeezy lifetime licenses retain their original device allowances.

Local builds default to a noindex preview with checkout disabled; no secrets are needed.
Production builds read each plan's checkout from a repository variable. Until all three
are set the production build fails, so neither CI nor the Pages deploy can pass.

## Coordinated launch gate

Do not merge this release into main until all of these are done. Pushing to main deploys.

1. Publish and verify the signed, notarized app with the local trial at the existing
   download URL, keeping the release bundle ID riccqi.TabTab and its Keychain service
   unchanged.
2. In that released app, verify a fresh local trial, an existing Polar trial (original
   expiry kept, no fresh local trial), a Polar subscription key, and a Lemon Squeezy key.
3. Create the three new production Polar checkouts with no Polar trial and a 3-Mac license
   benefit, and verify each key unlocks the released app.
4. Set the repository variables TABTAB_POLAR_CHECKOUT_MONTHLY_URL,
   TABTAB_POLAR_CHECKOUT_ANNUAL_URL and TABTAB_POLAR_CHECKOUT_LIFETIME_URL. The previous
   trial checkout is refused by the build. Leave it active only as far as existing
   customers need it; do not change their subscriptions.
5. Merge this website release into main, then confirm the public pricing page and all three
   checkouts show the same offer.

Full subscription refunds use Polar's native refund plus immediate subscription
revocation; refund alone does not revoke a subscription license. Client checks observe
revocation, subject to the approved bounded offline grace. Email contacts are synced
separately by the authenticated owner's manual Refresh from Polar action.

No app binary, Sparkle feed, customer email or backend deployment is part of this
website source change.

## Verification

Run npm run verify for the safe local preview. To check the production configuration
locally, run it with TABTAB_SUBSCRIPTION_ROLLOUT=on and three placeholder links in the
form https://api.polar.sh/v1/checkout-links/polar_cl_<id>/redirect. CI and the Pages
workflow run the same command and check pricing, the download flow, renewal disclosures,
provider links, routes and frontend-only content. Never publish a sandbox or a
short-lived checkout-session URL.
