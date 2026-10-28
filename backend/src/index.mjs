import { sha256, verifyToken, verifyLemon, verifyResend } from './crypto.mjs';
import { normalizeEmail, cleanContact, contactStatements } from './store.mjs';
import { dashboardAPI } from './dashboard-api.mjs';
import { dashboardHTML, dashboardCSS, dashboardScript } from './dashboard-ui.mjs';
import { sendEmail, drain } from './outbox.mjs';
import { reconcileStatement } from '@riccqi/email-studio/outbox';

const CONSENT = 'tabtab-updates-single-opt-in-v3';
const okMessage = "You're on the list!";
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const now = () => new Date().toISOString();
const json = (value, status = 200) => Response.json(value, { status });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function required(env, names) { if (names.some(name => !env[name])) fail('Email service is not configured yet. Please try again later.', 503); }

function page(title, text, form = '') {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · TabTab</title><style>body{font:18px system-ui;max-width:540px;margin:12vh auto;padding:24px;line-height:1.6;color:#17202a}button{font:inherit;border:0;border-radius:99px;background:#17202a;color:white;padding:12px 24px;cursor:pointer}a{color:inherit}</style><main><p>TabTab</p><h1>${esc(title)}</h1>${text?`<p>${esc(text)}</p>`:''}${form}<p><a href="https://tabtabapp.net">Back to TabTab</a></p></main></html>`, { headers: { 'Content-Type':'text/html; charset=utf-8' } });
}

async function bodyText(request, max = 65536) {
  if (Number(request.headers.get('content-length')) > max) fail('Request too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); fail('Request too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
function parseJSON(body) { try { return JSON.parse(body); } catch { fail('Invalid JSON.'); } }

async function subscribe(request, env) {
  if (request.headers.get('origin') !== env.SITE_ORIGIN) fail('This form must be submitted from the TabTab website.', 403);
  required(env, ['SIGNUP_LIMITER']);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!(await env.SIGNUP_LIMITER.limit({ key:ip })).success) fail('Too many attempts. Please wait a minute and try again.', 429);
  const raw = await bodyText(request, 4096);
  const type = request.headers.get('content-type') || '';
  const data = type.includes('application/json') ? parseJSON(raw) : Object.fromEntries(new URLSearchParams(raw));
  if (data.website) return json({ message:okMessage });
  const email = normalizeEmail(data.email);
  if (!email || data.consent !== 'yes') fail('Enter a valid email and agree to receive TabTab updates.');
  required(env, ['TURNSTILE_SECRET']);
  const challenge = data['cf-turnstile-response'];
  if (typeof challenge !== 'string' || !challenge || challenge.length > 2048) fail('The security check could not complete. Please try again.', 400);
  let verified;
  try {
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'POST', body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:challenge,remoteip:ip}),
      signal:AbortSignal.timeout(10000)
    });
    if (!result.ok) throw new Error('Verification unavailable');
    verified = await result.json();
  } catch { fail('The security check is temporarily unavailable. Please try again.',503); }
  if (verified.success !== true || verified.hostname !== new URL(env.SITE_ORIGIN).hostname || verified.action !== 'signup') fail('The security check could not complete. Please try again.',400);
  const name = typeof data.name === 'string' ? data.name.trim().slice(0,120) : '';
  await env.DB.batch(contactStatements(env.DB, { email, name, source:'website', external_id:email, status:'customer' }));
  // The explicit Subscribe action records single opt-in, not verified email ownership.
  // Repeated submissions preserve existing evidence; suppressed addresses never reactivate.
  await env.DB.prepare(`UPDATE contacts SET status='subscribed',consent_at=?,
    consent_source='website-single-opt-in',consent_version=?,subscription_basis='website_single_opt_in',
    unsubscribed_at=NULL,confirmation_nonce=NULL,confirmation_sent_at=NULL,updated_at=?
    WHERE email=? AND status NOT IN ('subscribed','suppressed')`)
    .bind(now(),CONSENT,now(),email).run();
  return type.includes('application/json') ? json({ message:okMessage }) : page(okMessage,'');
}

async function preference(request, env, purpose) {
  required(env, ['TOKEN_SECRET']);
  const value = new URL(request.url).searchParams.get('token');
  const data = await verifyToken(env.TOKEN_SECRET, value, purpose);
  if (!data) return new Response('This link is invalid or expired. Please sign up again at tabtabapp.net.', { status:400 });
  const contact = await env.DB.prepare('SELECT id,status,confirmation_nonce FROM contacts WHERE id=?').bind(data.id).first();
  if (!contact) return new Response('This link is no longer valid.', { status:400 });
  if (purpose === 'confirm' && (contact.confirmation_nonce !== data.nonce || contact.status === 'suppressed')) return new Response('This confirmation link is no longer valid. Please sign up again.', { status:400 });
  if (request.method === 'GET') {
    const confirming = purpose === 'confirm';
    // GET must not change state: mail security scanners commonly open every link.
    return page(confirming ? 'Confirm your subscription' : 'Unsubscribe from updates',
      confirming ? 'Receive occasional TabTab updates. You can unsubscribe at any time.' : 'Stop receiving TabTab update emails. This will not affect your purchase or license.',
      `<form method="post"><button type="submit">${confirming ? 'Confirm subscription' : 'Unsubscribe'}</button></form>`);
  }
  if (purpose === 'confirm') {
    const result = await env.DB.prepare(`UPDATE contacts SET status='subscribed',consent_at=?,consent_source='website-confirmation',
      consent_version=?,unsubscribed_at=NULL,confirmation_nonce=NULL,updated_at=? WHERE id=? AND confirmation_nonce=? AND status!='suppressed' RETURNING id`)
      .bind(now(),CONSENT,now(),data.id,data.nonce).first();
    if (!result) fail('This confirmation link is no longer valid.');
    return page('You’re subscribed','We’ll keep you posted with occasional TabTab news and updates.');
  }
  await env.DB.prepare(`UPDATE contacts SET status=CASE WHEN status='suppressed' THEN status ELSE 'unsubscribed' END,
    unsubscribed_at=?,confirmation_nonce=NULL,updated_at=? WHERE id=?`).bind(now(),now(),data.id).run();
  return page('You’re unsubscribed','You will no longer receive TabTab update emails.');
}

async function lemonWebhook(request, env) {
  required(env, ['LEMONSQUEEZY_WEBHOOK_SECRET','LEMONSQUEEZY_STORE_ID','LEMONSQUEEZY_PRODUCT_IDS']);
  const raw = await bodyText(request);
  if (!await verifyLemon(env.LEMONSQUEEZY_WEBHOOK_SECRET,raw,request.headers.get('x-signature'))) fail('Invalid signature.',401);
  const payload = parseJSON(raw); const a = payload.data?.attributes;
  if (payload.meta?.event_name !== 'order_created' || payload.data?.type !== 'orders') return json({ ignored:true });
  if (!a || a.test_mode !== false || String(a.store_id) !== env.LEMONSQUEEZY_STORE_ID || a.status !== 'paid') return json({ ignored:true });
  if (!env.LEMONSQUEEZY_PRODUCT_IDS.split(',').map(x=>x.trim()).includes(String(a.first_order_item?.product_id))) return json({ ignored:true });
  if (!payload.data.id || !normalizeEmail(a.user_email)) fail('Invalid order.');
  const eventId = `lemonsqueezy/order_created/${payload.data.id}`;
  if (await env.DB.prepare('SELECT id FROM webhook_events WHERE id=?').bind(eventId).first()) return json({ received:true,duplicate:true });
  // Owner-configured customer updates are recorded separately from explicit opt-in.
  const customerUpdates = env.LEMONSQUEEZY_CUSTOMER_UPDATES === 'true';
  const statements = contactStatements(env.DB,{ email:a.user_email,name:a.user_name,source:'lemonsqueezy',external_id:String(payload.data.id),status:customerUpdates ? 'subscribed' : 'customer',subscription_basis:customerUpdates ? 'customer_release_updates' : null });
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO webhook_events(id,received_at) VALUES (?,?)').bind(eventId,now()));
  await env.DB.batch(statements);
  return json({ received:true });
}

async function resendWebhook(request, env) {
  required(env,['RESEND_WEBHOOK_SECRET']);
  const raw = await bodyText(request);
  if (!await verifyResend(env.RESEND_WEBHOOK_SECRET,raw,request.headers)) fail('Invalid signature.',401);
  const payload = parseJSON(raw);
  // Resend emits account-wide events; another app's complaint must not alter this list.
  const from = String(payload.data?.from || '').trim().toLowerCase();
  if (!/^(?:(?:updates|richard)@tabtabapp\.net|tabtab\s*<(?:updates|richard)@tabtabapp\.net>|(?:richard from tabtab|"richard from tabtab")\s*<richard@tabtabapp\.net>)$/.test(from)) return json({ ignored:true });
  const statements = [];
  if (['email.bounced','email.complained','email.suppressed'].includes(payload.type)) {
    const addresses = payload.data?.to;
    if (!Array.isArray(addresses) || addresses.length > 100) fail('Invalid recipients.');
    statements.push(...addresses.map(normalizeEmail).filter(Boolean).map(email =>
      env.DB.prepare(`UPDATE contacts SET status='suppressed',confirmation_nonce=NULL,updated_at=? WHERE email=?`).bind(now(),email)));
  }
  const settled = reconcileStatement(env, payload);
  if (settled) statements.push(settled);
  if (!statements.length) return json({ ignored:true });
  await env.DB.batch(statements);
  return json({ received:true });
}

async function admin(request, env, path) {
  required(env,['ADMIN_TOKEN']);
  const supplied = request.headers.get('authorization') || '';
  if (await sha256(supplied) !== await sha256(`Bearer ${env.ADMIN_TOKEN}`)) fail('Unauthorized.',401);
  if (path === '/admin/contacts' && request.method === 'GET') {
    const url = new URL(request.url); const after = url.searchParams.get('after') || '';
    const rows = await env.DB.prepare(`SELECT id,email,name,status,consent_at,consent_source,consent_version,subscription_basis,unsubscribed_at,created_at,updated_at
      FROM contacts WHERE id>? ORDER BY id LIMIT 100`).bind(after).all();
    return json({ contacts:rows.results,next:rows.results.length===100 ? rows.results.at(-1).id : null });
  }
  if (path === '/admin/import' && request.method === 'POST') {
    const records = parseJSON(await bodyText(request));
    if (!Array.isArray(records) || records.length<1 || records.length>25) fail('Import 1–25 contacts at a time.');
    try { records.forEach(cleanContact); } catch (error) { fail(error.message); }
    await env.DB.batch(records.flatMap(row=>contactStatements(env.DB,row)));
    return json({ imported:records.length });
  }
  return json({ error:'Not found.' },404);
}

export default {
  async scheduled(event,env,ctx) {
    ctx.waitUntil(drain(env));
  },
  async fetch(request,env) {
    let response;
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/dashboard/api/')) response = await dashboardAPI(request,env,{sendEmail,normalizeEmail});
      else if (['/dashboard','/dashboard/'].includes(path) && request.method === 'GET' && env.STUDIO_URL) response = new Response(null,{status:302,headers:{Location:env.STUDIO_URL}});
      else if (path === '/dashboard' && request.method === 'GET') response = new Response(dashboardHTML,{headers:{'Content-Type':'text/html; charset=utf-8'}});
      else if (path === '/dashboard/app.js' && request.method === 'GET') response = new Response(dashboardScript,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
      else if (path === '/dashboard/style.css' && request.method === 'GET') response = new Response(dashboardCSS,{headers:{'Content-Type':'text/css; charset=utf-8'}});
      else if (path === '/dashboard/test-unsubscribe' && request.method === 'GET') response = page('This is a test email','The unsubscribe link in a real updates that recipient’s subscription immediately. No subscription was changed.');
      else if (request.method === 'OPTIONS') {
        response = request.headers.get('origin') === env.SITE_ORIGIN && path === '/subscribe' ? new Response(null,{ status:204 }) : json({ error:'Forbidden.' },403);
      } else if (path === '/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT 1 FROM contacts LIMIT 1').first();
        response = json({ ok:true, signup_ready:Boolean(env.TURNSTILE_SECRET && env.SIGNUP_LIMITER) });
      } else if (path === '/subscribe' && request.method === 'POST') response = await subscribe(request,env);
      else if (['/confirm','/unsubscribe'].includes(path) && ['GET','POST'].includes(request.method)) response = await preference(request,env,path.slice(1));
      else if (path === '/webhooks/lemonsqueezy' && request.method === 'POST') response = await lemonWebhook(request,env);
      else if (path === '/webhooks/resend' && request.method === 'POST') response = await resendWebhook(request,env);
      else if (path.startsWith('/admin/')) response = await admin(request,env,path);
      else response = json({ error:'Not found.' },404);
    } catch(error) {
      // Do not log payloads, email addresses, credentials or preference-link tokens.
      response = json({ error:error.status ? error.message : 'Something went wrong. Please try again later.' },error.status || 500);
    }
    response.headers.set('Cache-Control','no-store');
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Content-Security-Policy',new URL(request.url).pathname.startsWith('/dashboard') ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: data:; connect-src 'self'; frame-src 'self' about:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" : "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (request.headers.get('origin') === env.SITE_ORIGIN && new URL(request.url).pathname === '/subscribe') {
      response.headers.set('Access-Control-Allow-Origin',env.SITE_ORIGIN);
      response.headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers','Content-Type');
      response.headers.set('Vary','Origin');
    }
    return response;
  }
};
