// Unit checks for the billing rules in src/data/billing.mjs.
import assert from "node:assert/strict";
import { annualPerMonth, annualSavingPercent, billingConfig, checkoutUrl, defaultPlanId, macsPerPlan, plans, portalUrl, rolloutMode, trialDays } from "../src/data/billing.mjs";

const link = id => `https://api.polar.sh/v1/checkout-links/polar_cl_${id}/redirect`;
const allLinks = {
  TABTAB_POLAR_CHECKOUT_MONTHLY_URL: link("Monthly123"),
  TABTAB_POLAR_CHECKOUT_ANNUAL_URL: link("Annual123"),
  TABTAB_POLAR_CHECKOUT_LIFETIME_URL: link("Lifetime123"),
};
const RETIRED = link("xUfKGtMMTdza7ZCvzGAjePjlTzEtGgVEbBeBK2S3v8Q");

const checks = [
  ["rollout defaults to preview and rejects unknown modes", () => {
    assert.equal(rolloutMode(undefined), "preview");
    assert.equal(rolloutMode(""), "preview");
    assert.equal(rolloutMode("on"), "on");
    assert.throws(() => rolloutMode("off"));
    assert.throws(() => rolloutMode("true"));
    assert.throws(() => rolloutMode("ON"));
  }],
  ["the approved offer: monthly, annual by default, lifetime, 7-day trial, 3 Macs", () => {
    assert.deepEqual(plans.map(plan => [plan.id, plan.price, plan.unit]), [
      ["monthly", "4.99", "/month"],
      ["annual", "34.99", "/year"],
      ["lifetime", "99.99", "once"],
    ]);
    assert.equal(defaultPlanId, "annual");
    assert.equal(annualPerMonth, "2.92");
    assert.equal(annualSavingPercent, 42);
    assert.equal(trialDays, 7);
    assert.equal(macsPerPlan, 3);
  }],
  ["preview without checkout links shows the coming-soon state and noindex", () => {
    const config = billingConfig({});
    assert.equal(config.mode, "preview");
    assert.deepEqual({ ...config.checkout }, { monthly: null, annual: null, lifetime: null });
    assert.equal(config.noindex, true);
  }],
  ["on requires all three new production checkout links", () => {
    assert.throws(() => billingConfig({ TABTAB_SUBSCRIPTION_ROLLOUT: "on" }));
    for (const missing of Object.keys(allLinks)) {
      assert.throws(() => billingConfig({ TABTAB_SUBSCRIPTION_ROLLOUT: "on", ...allLinks, [missing]: "" }), new RegExp(missing));
    }
    const config = billingConfig({ TABTAB_SUBSCRIPTION_ROLLOUT: "on", ...allLinks });
    assert.equal(config.checkout.annual, link("Annual123"));
    assert.equal(config.noindex, false);
  }],
  ["the retired checkout variable alone cannot launch the site", () => {
    assert.throws(() => billingConfig({ TABTAB_SUBSCRIPTION_ROLLOUT: "on", TABTAB_POLAR_CHECKOUT_URL: link("Example123") }));
  }],
  ["the retired Polar trial checkout is refused for every plan", () => {
    for (const name of Object.keys(allLinks)) {
      assert.throws(() => billingConfig({ ...allLinks, [name]: RETIRED }), /retired/);
    }
  }],
  ["each plan needs its own checkout link", () => {
    assert.throws(() => billingConfig({ ...allLinks, TABTAB_POLAR_CHECKOUT_ANNUAL_URL: allLinks.TABTAB_POLAR_CHECKOUT_MONTHLY_URL }), /own checkout/);
  }],
  ["checkout links must be persistent production Polar checkout links", () => {
    assert.equal(checkoutUrl(undefined), null);
    assert.equal(checkoutUrl("  "), null);
    assert.equal(checkoutUrl(" https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect "), "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect");
    for (const bad of [
      // Checkout sessions are short-lived and must never be published.
      "https://polar.sh/checkout/polar_c_Example123",
      "https://api.polar.sh/v1/checkout-links/polar_c_Example123/redirect",
      // Not yet seen on a real production link.
      "https://buy.polar.sh/polar_cl_Example123",
      // Other Polar pages.
      "https://polar.sh/dashboard/tabtab/products",
      "https://polar.sh/legal/terms",
      "https://polar.sh/tabtab/portal",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect/",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect/extra",
      "https://api.polar.sh/v1/checkout-links/polar_cl_/redirect",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Exa-mple/redirect",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123%2F../redirect",
      // Queries (including session tokens) and fragments.
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect?customer_session_token=secret",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect?customer_email=a@example.com",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect?",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect#x",
      "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect#",
      "https://api.polar.sh:8443/v1/checkout-links/polar_cl_Example123/redirect",
      "https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_example/redirect",
      "https://sandbox.polar.sh/checkout/polar_c_example",
      "https://polar.sh/sandbox/checkout",
      "http://buy.polar.sh/polar_cl_example",
      "https://user:pass@buy.polar.sh/polar_cl_example",
      "https://tabtab.lemonsqueezy.com/checkout/buy/example",
      "https://evil.example/polar.sh",
      "https://buy.polar.sh.evil.example/x",
      "https://buy.polar.sh/",
      "javascript:alert(1)",
      "not a url",
    ]) {
      assert.throws(() => checkoutUrl(bad), undefined, bad);
    }
  }],
  ["portal links must be https://polar.sh/<org-slug>/portal", () => {
    assert.equal(portalUrl(""), null);
    assert.equal(portalUrl("https://polar.sh/tabtab/portal"), "https://polar.sh/tabtab/portal");
    for (const bad of ["https://sandbox.polar.sh/tabtab-subscription-qa/portal", "https://polar.sh/tabtab", "https://polar.sh/tabtab/portal?x=1", "https://example.com/tabtab/portal",
      "https://polar.sh:8443/tabtab/portal", "https://polar.sh/tabtab/portal?", "https://polar.sh/tabtab/portal#", "https://polar.sh/tabtab/portal#x",
      "http://polar.sh/tabtab/portal", "https://u:p@polar.sh/tabtab/portal"]) {
      assert.throws(() => portalUrl(bad), undefined, bad);
    }
  }],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    run();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}\n  ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
else console.log(`Validated ${checks.length} billing rules.`);
