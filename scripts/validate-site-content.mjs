// Checks the built site (dist/) against the billing rollout mode it was built for.
// No sandbox or private references, only known external hosts, no old Lemon Squeezy
// sales or free/promo claims, and the download flow, plans and checkout state are present.
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { billingConfig, downloadUrl, plans } from "../src/data/billing.mjs";

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
for (const link of [...Object.values(billing.checkout), billing.portalUrl]) if (link) knownHosts.add(new URL(link).hostname);

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
    /pay once/i, /money[- ]back/i, /(refund|satisfaction) guarantee/i, /TABTAB2/,
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
  for (const required of ["Monthly", "Annual", "Lifetime", "$4.99", "/month", "$34.99", "/year", "About $2.92/month", "billed annually",
    "Saves about 42% vs monthly", "$99.99", "once", "Includes future updates", "Try for Free", "up to 3 Macs", "Renews until you cancel"]) {
    if (!text.includes(required)) failures.push(`/pricing/: missing "${required}"`);
  }
  // Claims and options established for Paste, not for TabTab, and the old Polar trial offer.
  for (const banned of [/most popular/i, /app store/i, /iphone|ipad/i, /every device/i, /start free trial/i, /after trial/i]) {
    if (banned.test(text)) failures.push(`/pricing/: must not say ${banned}`);
  }
  const radios = pricing.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  if (radios.length !== 3) failures.push(`/pricing/: expected 3 plan options, found ${radios.length}`);
  const checked = radios.filter(radio => /\bchecked\b/.test(radio));
  if (checked.length !== 1 || !/value="annual"/.test(checked[0] ?? "")) failures.push("/pricing/: Annual must be the only plan selected by default");
  if (!pricing.includes('href="/download/"')) failures.push("/pricing/: Try for Free must lead to /download/");
  for (const plan of plans) {
    const link = billing.checkout[plan.id];
    if (link) {
      if (!pricing.includes(`href="${link}"`)) failures.push(`/pricing/: missing the ${plan.id} checkout link`);
    }
  }
  if (Object.values(billing.checkout).every(Boolean)) {
    if (!text.includes("Buy Now")) failures.push('/pricing/: missing "Buy Now"');
  } else if (!text.includes("Checkout coming soon")) failures.push("/pricing/: missing the coming-soon state");
  if (/\b(?:1|one) Mac(?: per subscription)?\b/i.test(text)) failures.push("/pricing/: stale one-Mac offer");
  if ((pricing.match(/<h1\b/gi) ?? []).length !== 1) failures.push("/pricing/: expected one h1");
  if (!Object.values(billing.checkout).some(Boolean) && /href="https:\/\/(buy\.|api\.)polar\.sh/i.test(pricing)) {
    failures.push("/pricing/: links to a Polar checkout without a verified link");
  }
  // New FAQ entries must expose their state to assistive technology.
  for (const button of pricing.match(/<button[^>]*aria-controls[^>]*>/g) ?? []) {
    if (!/type="button"/.test(button) || !/aria-expanded/.test(button)) failures.push("/pricing/: FAQ button missing type or aria-expanded");
  }
  if (!/<button[^>]*:aria-controls=/.test(pricing)) failures.push("/pricing/: subscription FAQ entries missing aria-controls");
}
const download = pages.get("/download/");
if (!download) failures.push("/download/: missing");
else {
  const text = visibleText(download);
  for (const required of ["Download for Mac", "Requires macOS 14 or later", "Seven days of full access",
    "No account or card", "No automatic charge"]) {
    if (!text.includes(required)) failures.push(`/download/: missing "${required}"`);
  }
  if (!download.includes(`href="${downloadUrl}"`)) failures.push("/download/: missing the direct download link");
  // Nothing may stand between a visitor and the download.
  if (/<form\b/i.test(download) || /type="email"/i.test(download)) failures.push("/download/: must not capture email");
  if (/href="https:\/\/api\.polar\.sh/i.test(download)) failures.push("/download/: must not link to checkout");
  if (/most popular|app store|iphone|ipad|every device/i.test(text)) failures.push("/download/: repeats a claim not established for TabTab");
}
// Every marketing action goes through /download/; only that page links the installer.
for (const [route, html] of pages) {
  if (route !== "/download/" && html.includes(`href="${downloadUrl}"`)) failures.push(`${route}: links straight to the installer instead of /download/`);
}
const home = pages.get("/");
if (home && !/href="\/download\/"[^>]*>\s*Try for Free/.test(home)) failures.push('/: primary action must be "Try for Free" leading to /download/');
const privacy = visibleText(pages.get("/privacy/") ?? "");
for (const required of ["license key", "activation identifier", "device label", "Polar", "Lemon Squeezy", "does not subscribe you to updates"]) {
  if (!privacy.includes(required)) failures.push(`/privacy/: missing license disclosure "${required}"`);
}
if (/Freemium|does not collect (?:any )?user-identifiable|does not store personally identifiable|only collects anonymized usage/i.test(privacy)) failures.push("/privacy/: still says Freemium or no identifiable data");
const terms = visibleText(pages.get("/terms/") ?? "");
for (const required of ["US$4.99/month", "US$34.99/year", "US$99.99 once", "renews automatically", "original end date", "Cancelling stops future renewals", "cancelled immediately", "lifetime licenses keep working"]) {
  if (!terms.includes(required)) failures.push(`/terms/: missing "${required}"`);
}
if (/Freemium|does not collect or store any personal data/.test(terms)) failures.push("/terms/: stale service or data disclosure");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} pages for rollout mode "${billing.mode}"${Object.values(billing.checkout).every(Boolean) ? " with checkouts" : ""}.`);
}
