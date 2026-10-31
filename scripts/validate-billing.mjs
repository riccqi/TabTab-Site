// Unit checks for the billing rules in src/data/billing.mjs.
import assert from "node:assert/strict";
import { billingConfig, checkoutUrl, portalUrl, rolloutMode } from "../src/data/billing.mjs";

const checks = [
  ["rollout defaults to preview and rejects unknown modes", () => {
    assert.equal(rolloutMode(undefined), "preview");
    assert.equal(rolloutMode(""), "preview");
    assert.equal(rolloutMode("on"), "on");
    assert.throws(() => rolloutMode("off"));
    assert.throws(() => rolloutMode("true"));
    assert.throws(() => rolloutMode("ON"));
  }],
  ["preview without a checkout link shows the coming-soon state and noindex", () => {
    const config = billingConfig({});
    assert.equal(config.mode, "preview");
    assert.equal(config.checkoutUrl, null);
    assert.equal(config.noindex, true);
  }],
  ["on requires a production checkout link", () => {
    assert.throws(() => billingConfig({ TABTAB_SUBSCRIPTION_ROLLOUT: "on" }));
    const config = billingConfig({ TABTAB_SUBSCRIPTION_ROLLOUT: "on", TABTAB_POLAR_CHECKOUT_URL: "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect" });
    assert.equal(config.checkoutUrl, "https://api.polar.sh/v1/checkout-links/polar_cl_Example123/redirect");
    assert.equal(config.noindex, false);
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
