import { drain as drainOutbox, sendOne } from '@riccqi/email-studio/outbox';
import { token } from './crypto.mjs';
import { renderEmail } from './email-template.mjs';

// Delivery rules live in the shared outbox (also used by OpenCam). This file only
// decides who is eligible and what each TabTab email contains.
export const sender = env => ({ app:'tabtab', from:env.FROM_EMAIL, replyTo:env.REPLY_TO, apiKey:env.RESEND_API_KEY });

// One email now: sign-in codes and tests. Throws unless Resend accepted it.
export async function sendEmail(env, { to, ...message }, key) {
  const result = await sendOne(sender(env), to, message, key);
  if (result.status !== 'sent') throw Object.assign(new Error('Email delivery failed. Please try again later.'), { status:503, code:result.code });
  return { id:result.messageId };
}

const UNSUBSCRIBE_TOKEN = 'tabtab-unsubscribe-token';
// Render once per campaign; each recipient only swaps in their unsubscribe token.
function campaignRenderer(env, campaign) {
  const base = `${env.PUBLIC_URL}/unsubscribe?token=`;
  const template = renderEmail({ ...campaign, postalAddress:campaign.postal_address, unsubscribeUrl:base + UNSUBSCRIBE_TOKEN });
  return async contactId => {
    const value = encodeURIComponent(await token(env.TOKEN_SECRET, { id:contactId, purpose:'unsubscribe' }));
    return { subject:campaign.subject, html:template.html.replaceAll(UNSUBSCRIBE_TOKEN, value), text:template.text.replaceAll(UNSUBSCRIBE_TOKEN, value), unsubscribe:base + value };
  };
}

async function prepare(env, deliveries) {
  const rows = (await env.DB.prepare(`SELECT d.id,c.id contact_id,c.email,c.status,k.state campaign_state,k.subject,k.markdown,k.preheader,k.postal_address
    FROM json_each(?) j JOIN deliveries d ON d.id=j.value LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN campaigns k ON k.id=d.campaign_id`)
    .bind(JSON.stringify(deliveries.map(d => d.id))).all()).results;
  const byId = Object.fromEntries(rows.map(r => [r.id, r])), renderers = {};
  return Promise.all(deliveries.map(async d => {
    const r = byId[d.id];
    if (d.kind !== 'announcement' || !r?.campaign_state) return { skip:'campaign_missing' };
    if (r.campaign_state !== 'sending') return { hold:true };
    if (r.status !== 'subscribed') return { skip:'not_subscribed' };
    if (!r.postal_address?.trim()) return { skip:'postal_address_missing' };
    const render = renderers[d.campaign_id] ??= campaignRenderer(env, r);
    return { recipient:r.email, message:await render(r.contact_id) };
  }));
}

export function drain(env, deps = {}) {
  if (!env.TOKEN_SECRET || !env.PUBLIC_URL) throw new Error('Email service is not configured.');
  return drainOutbox(env, {
    sender:sender(env),
    // Paused campaigns stay queued without being claimed.
    claimable:{ sql:"kind!='announcement' OR EXISTS(SELECT 1 FROM campaigns c WHERE c.id=deliveries.campaign_id AND c.state='sending')", args:[] },
    prepare
  }, deps);
}
