// Checks the built site (dist/) against the billing rollout mode it was built for.
// No sandbox or private references, only known external hosts, no lifetime sales or
// old free/one-time/promo claims, and the trial terms and checkout state are present.
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { billingConfig } from "../src/data/billing.mjs";

const billing = billingConfig();
const failures = [];

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  }));
  return nested.flat();
}

const visibleText = html => html
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&#39;|&#x27;|&apos;|&rsquo;|’/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

const knownHosts = new Set([
  "tabtabapp.net", "github.com", "app.lemonsqueezy.com", "unpkg.com", "www.googletagmanager.com",
  "x.com", "www.youtube.com", "discord.gg", "www.producthunt.com", "api.producthunt.com", "alt-tab.app",
  "challenges.cloudflare.com", "www.linkedin.com", "www.cloudflare.com", "telemetrydeck.com", "support.apple.com",
  "updates.tabtabapp.net", // the existing public email-signup form
]);
for (const link of [billing.checkoutUrl, billing.portalUrl]) if (link) knownHosts.add(new URL(link).hostname);

const private_ = [/email-system/i, /\/webhooks\//i, /whsec_/i, /POLAR_WEBHOOK/i, /sandbox(-api)?\.polar\.sh/i, /polar_c_[A-Za-z0-9]{10,}/];

const files = await htmlFiles("dist");
const pages = new Map();
for (const file of files) {
  const html = await readFile(file, "utf8");
  const route = file.replace(/^dist/, "").replace(/index\.html$/, "");
  pages.set(route, html);

  for (const pattern of private_) if (pattern.test(html)) failures.push(`${route}: contains ${pattern}`);
  for (const [, host] of html.matchAll(/(?:href|src|action)="https?:\/\/([^"/:?#]+)/g)) {
    if (!knownHosts.has(host)) failures.push(`${route}: unexpected external host ${host}`);
  }
  if (/href="https?:\/\/[^"]*sandbox/i.test(html)) failures.push(`${route}: links to a sandbox URL`);

  const hasNoindex = /<meta\s+name="robots"\s+content="noindex/i.test(html);
  // Static files from public/ (e.g. the Google site-verification page) have no layout.
  const isSitePage = /<link\s+rel="canonical"/i.test(html);
  if (billing.noindex && isSitePage && !hasNoindex) failures.push(`${route}: preview build must be noindex`);
  if (!billing.noindex && hasNoindex) failures.push(`${route}: unexpected noindex`);

  if (/tabtab\.lemonsqueezy\.com\/checkout/i.test(html)) failures.push(`${route}: still sells lifetime licenses`);
  const text = visibleText(html);
  for (const banned of [
    /one[- ]time purchase/i, /lifetime access/i, /pay once/i, /money[- ]back/i, /(refund|satisfaction) guarantee/i, /TABTAB2/,
    /launch promo/i, /free plan/i, /free tier/i, /try tabtab for free/i, /try tabtab free on/i, /buy license/i,
    /no subscription/i, /students?\b/i, /\$1[59]\.|\$26\./,
  ]) {
    if (banned.test(text)) failures.push(`${route}: subscription copy still says ${banned}`);
  }
}

// Every site-relative link must resolve to a built file.
const exists = path => access(path).then(() => true, () => false);
for (const [route, html] of pages) {
  for (const [, href] of html.matchAll(/href="(\/(?!\/)[^"#?]*)/g)) {
    const target = join("dist", href.endsWith("/") ? `${href}index.html` : href);
    if (!(await exists(target))) failures.push(`${route}: broken internal link ${href}`);
  }
}

const pricing = pages.get("/pricing/");
if (!pricing) failures.push("/pricing/: missing");
else {
  const text = visibleText(pricing);
  for (const required of ["$4.99", "7-day free trial", "Renews automatically at US$4.99/month", "Cancel before then to avoid charges",
    "Up to 2 Macs per subscription", "Cancel anytime"]) {
    if (!text.includes(required)) failures.push(`/pricing/: missing "${required}"`);
  }
  if (/\b(?:1|one) Mac(?: per subscription)?\b/i.test(text)) failures.push("/pricing/: stale one-Mac offer");
  if ((pricing.match(/<h1\b/gi) ?? []).length !== 1) failures.push("/pricing/: expected one h1");
  if (billing.checkoutUrl) {
    if (!pricing.includes(`href="${billing.checkoutUrl}"`)) failures.push("/pricing/: missing the checkout link");
  } else {
    if (!text.includes("Subscriptions are coming soon")) failures.push("/pricing/: missing the coming-soon state");
    if (/href="https:\/\/(buy\.|api\.)?polar\.sh/i.test(pricing)) failures.push("/pricing/: links to Polar without a verified checkout");
  }
  // New FAQ entries must expose their state to assistive technology.
  for (const button of pricing.match(/<button[^>]*aria-controls[^>]*>/g) ?? []) {
    if (!/type="button"/.test(button) || !/aria-expanded/.test(button)) failures.push("/pricing/: FAQ button missing type or aria-expanded");
  }
  if (!/<button[^>]*:aria-controls=/.test(pricing)) failures.push("/pricing/: subscription FAQ entries missing aria-controls");
}
const privacy = visibleText(pages.get("/privacy/") ?? "");
for (const required of ["license key", "activation identifier", "device label", "Polar", "Lemon Squeezy", "does not subscribe you to updates"]) {
  if (!privacy.includes(required)) failures.push(`/privacy/: missing license disclosure "${required}"`);
}
if (/Freemium|does not collect (?:any )?user-identifiable|does not store personally identifiable|only collects anonymized usage/i.test(privacy)) failures.push("/privacy/: still says Freemium or no identifiable data");
const terms = visibleText(pages.get("/terms/") ?? "");
for (const required of ["US$4.99/month", "renews automatically", "Cancelling stops future renewals", "cancelled immediately", "lifetime licenses keep working"]) {
  if (!terms.includes(required)) failures.push(`/terms/: missing "${required}"`);
}
if (/Freemium|does not collect or store any personal data/.test(terms)) failures.push("/terms/: stale service or data disclosure");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} pages for rollout mode "${billing.mode}"${billing.checkoutUrl ? " with checkout" : ""}.`);
}
