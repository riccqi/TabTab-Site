// Shared billing configuration for the site.
//
// New customers download TabTab, get a local trial with no account or card, and can
// buy a Monthly, Annual or Lifetime plan through Polar at any time.
// TABTAB_SUBSCRIPTION_ROLLOUT picks how the site is built:
//   preview  the default, for local review; noindex. A plan without a verified
//            production checkout link shows "Checkout coming soon".
//   on       for launch; the build fails unless all three plans have their own valid
//            production checkout link.
// Plain JavaScript so the Node validation scripts use the same rules as the build.

export const ROLLOUT_MODES = ["preview", "on"];

export const trialDays = 7;
/** How many Macs every paid plan covers. */
export const macsPerPlan = 3;
export const currency = "USD";

const MONTHLY_CENTS = 499;
const ANNUAL_CENTS = 3499;
const LIFETIME_CENTS = 9999;

const dollars = cents => (cents / 100).toFixed(2);

/** "2.92": the annual price spread over twelve months. */
export const annualPerMonth = dollars(ANNUAL_CENTS / 12);
/** 42: how much the annual plan saves against twelve monthly payments, in percent. */
export const annualSavingPercent = Math.round((1 - ANNUAL_CENTS / (MONTHLY_CENTS * 12)) * 100);

/** Plans for new customers, in display order. */
export const plans = Object.freeze([
  {
    id: "monthly",
    label: "Monthly",
    price: dollars(MONTHLY_CENTS),
    unit: "/month",
    detail: "Billed monthly. Renews until you cancel.",
    checkoutEnv: "TABTAB_POLAR_CHECKOUT_MONTHLY_URL",
  },
  {
    id: "annual",
    label: "Annual",
    price: dollars(ANNUAL_CENTS),
    unit: "/year",
    detail: `About $${annualPerMonth}/month, billed annually. Renews until you cancel.`,
    checkoutEnv: "TABTAB_POLAR_CHECKOUT_ANNUAL_URL",
  },
  {
    id: "lifetime",
    label: "Lifetime",
    price: dollars(LIFETIME_CENTS),
    unit: "once",
    detail: "One payment. Includes future updates.",
    checkoutEnv: "TABTAB_POLAR_CHECKOUT_LIFETIME_URL",
  },
]);

export const defaultPlanId = "annual";

/** "US$4.99/month, US$34.99/year or US$99.99 once" */
export const planPriceSummary = "US$4.99/month, US$34.99/year or US$99.99 once";

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

// The previous offer's checkout, which starts a 7-day Polar trial. It must never be
// sold from the new pricing page: those customers already keep their own schedule.
const RETIRED_TRIAL_CHECKOUT = "polar_cl_xUfKGtMMTdza7ZCvzGAjePjlTzEtGgVEbBeBK2S3v8Q";

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
export function checkoutUrl(value, label = "Checkout URL") {
  if (value === undefined || value === null || value.trim() === "") return null;
  const raw = value.trim();
  const url = parseHttps(raw, label);
  if (url.hostname !== "api.polar.sh" || url.port || !CHECKOUT_LINK.test(url.pathname) || url.search || url.hash || raw.includes("#") || raw.includes("?")) {
    throw new Error(`${label} must be https://api.polar.sh/v1/checkout-links/polar_cl_<id>/redirect with no query or fragment.`);
  }
  if (url.pathname.includes(RETIRED_TRIAL_CHECKOUT)) {
    throw new Error(`${label} is the retired Polar trial checkout; use the plan's new checkout.`);
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
  const checkout = Object.freeze(Object.fromEntries(
    plans.map(plan => [plan.id, checkoutUrl(env[plan.checkoutEnv], plan.checkoutEnv)]),
  ));
  const portal = portalUrl(env.TABTAB_POLAR_PORTAL_URL);
  if (mode === "on") {
    const missing = plans.filter(plan => !checkout[plan.id]).map(plan => plan.checkoutEnv);
    if (missing.length) throw new Error(`TABTAB_SUBSCRIPTION_ROLLOUT=on needs production checkout links: ${missing.join(", ")}.`);
  }
  const links = Object.values(checkout).filter(Boolean);
  if (new Set(links).size !== links.length) throw new Error("Each plan needs its own checkout link.");
  return Object.freeze({
    mode,
    checkout,
    portalUrl: portal,
    noindex: mode === "preview",
  });
}

export const billing = billingConfig();
