# TabTab subscription website release

Offer: US$4.99/month after a 7-day free trial, auto-renewing, up to 2 Macs.
Existing Lemon Squeezy lifetime licenses retain their original device allowances.

The GitHub Pages deploy workflow builds production mode with the verified persistent
Polar checkout and customer portal. CI verifies the same configuration. Local builds
default to a noindex preview with checkout disabled; no secrets are needed to build.

## Coordinated launch gate

Do not merge this release into main until the public app download supports Polar.
On 2026-10-31 the prod/tabtab-latest.dmg download was still 2.2.2 (160), which supports
only Lemon Squeezy. New Polar licenses cannot unlock that binary.

1. Publish and verify the signed, notarized Polar-capable app at the existing download
   URL, keeping the release bundle ID riccqi.TabTab and its Keychain service unchanged.
2. Verify an existing lifetime key and a new Polar key in that released app.
3. Merge this website release into main. The established GitHub Pages workflow builds
   and publishes it. Confirm the public pricing page and checkout show the same offer.
4. Retire new lifetime sales in Lemon Squeezy without changing existing licenses or
   activation limits. Keep order lookup and legacy validation available.

Full subscription refunds use Polar's native refund plus immediate subscription
revocation; refund alone does not revoke a subscription license. Client checks observe
revocation, subject to the approved bounded offline grace. Email contacts are synced
separately by the authenticated owner's manual Refresh from Polar action.

No app binary, Sparkle feed, customer email or backend deployment is part of this
website source change.

## Verification

Run npm run verify for the safe local preview. The CI and Pages workflows run the
same command in production configuration and check pricing, renewal disclosures,
provider links, routes and frontend-only content. Never publish a sandbox or a
short-lived checkout-session URL.

The two-Mac limit is configured on the existing Polar benefit. Public build165 already
uses provider-enforced activation limits; only its embedded one-Mac offer text awaits
a later app release. No new app build is part of this device-limit change.
