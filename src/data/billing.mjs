// Shared billing configuration for the site.
//
// TabTab subscriptions are sold through Polar. TABTAB_SUBSCRIPTION_ROLLOUT picks
// how the site is built:
//   preview  the default, for local review; noindex. Without a verified
//            production checkout link, the CTA shows "coming soon".
//   on       for launch; the build fails without a valid production checkout link.
// Plain JavaScript so the Node validation scripts use the same rules as the build.

export const ROLLOUT_MODES = ["preview", "on"];

/** Approved plan for new customers. */
export const subscriptionPlan = Object.freeze({
  price: "4.99",
  currency: "USD",
  interval: "month",
  trialDays: 7,
  devices: 1,
});

export const downloadUrl = "https://github.com/riccqi/TabTabApp/releases/download/prod/tabtab-latest.dmg";

/** Order lookup for existing lifetime (Lemon Squeezy) licenses. */
export const lifetimeManageUrl = "https://app.lemonsqueezy.com/my-orders/login";

// Persistent production Polar checkout links only. Polar's docs don't show the
// URL format; this persistent production form was verified on the live TabTab
// checkout on 2026-10-31.
// Checkout sessions (/checkout/polar_c_…, short-lived), other Polar pages, query
// strings (e.g. customer_session_token) and fragments are refused. Another
// production alias is unnecessary: the canonical API redirect is used throughout.
const CHECKOUT_LINK = /^\/v1\/checkout-links\/polar_cl_[A-Za-z0-9]+\/redirect$/;

function parseHttps(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use https.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (/sandbox/i.test(url.hostname) || /sandbox/i.test(url.pathname)) throw new Error(`${label} must not be a sandbox link.`);
  return url;
}

/** A persistent production Polar checkout link, or null when unset. Anything else throws. */
export function checkoutUrl(value) {
  if (value === undefined || value === null || value.trim() === "") return null;
  const raw = value.trim();
  const url = parseHttps(raw, "TABTAB_POLAR_CHECKOUT_URL");
  if (url.hostname !== "api.polar.sh" || url.port || !CHECKOUT_LINK.test(url.pathname) || url.search || url.hash || raw.includes("#") || raw.includes("?")) {
    throw new Error("TABTAB_POLAR_CHECKOUT_URL must be https://api.polar.sh/v1/checkout-links/polar_cl_<id>/redirect with no query or fragment.");
  }
  return url.href;
}

/** Polar's hosted customer portal, https://polar.sh/<org-slug>/portal, or null. */
export function portalUrl(value) {
  if (value === undefined || value === null || value.trim() === "") return null;
  const raw = value.trim();
  const url = parseHttps(raw, "TABTAB_POLAR_PORTAL_URL");
  if (url.hostname !== "polar.sh" || url.port || !/^\/[a-z0-9-]+\/portal\/?$/.test(url.pathname) || url.search || url.hash || raw.includes("?") || raw.includes("#")) {
    throw new Error("TABTAB_POLAR_PORTAL_URL must be https://polar.sh/<org-slug>/portal.");
  }
  return url.href;
}

export function rolloutMode(value) {
  const mode = (value ?? "").trim() || "preview";
  if (!ROLLOUT_MODES.includes(mode)) {
    throw new Error(`TABTAB_SUBSCRIPTION_ROLLOUT must be one of ${ROLLOUT_MODES.join(", ")}.`);
  }
  return mode;
}

export function billingConfig(env = process.env) {
  const mode = rolloutMode(env.TABTAB_SUBSCRIPTION_ROLLOUT);
  const checkout = checkoutUrl(env.TABTAB_POLAR_CHECKOUT_URL);
  const portal = portalUrl(env.TABTAB_POLAR_PORTAL_URL);
  if (mode === "on" && !checkout) {
    throw new Error("TABTAB_SUBSCRIPTION_ROLLOUT=on needs a production TABTAB_POLAR_CHECKOUT_URL.");
  }
  return Object.freeze({
    mode,
    checkoutUrl: checkout,
    portalUrl: portal,
    noindex: mode === "preview",
  });
}

export const billing = billingConfig();

/** The price with its currency, so buyers outside the US aren't misled: "US$4.99". */
export const planAmount = `US$${subscriptionPlan.price}`;
/** The headline price on the pricing card: "$4.99". The renewal terms beside it keep "US$". */
export const planDisplayAmount = `$${subscriptionPlan.price}`;
/** "US$4.99/month" */
export const planPrice = `${planAmount}/${subscriptionPlan.interval}`;
