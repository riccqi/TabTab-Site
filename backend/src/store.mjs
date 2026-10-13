export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}
export function cleanContact(input) {
  const email = normalizeEmail(input?.email);
  if (!email || !['website','formspree','lemonsqueezy','manual'].includes(input.source) || typeof input.external_id !== 'string' || !input.external_id || input.external_id.length > 300) throw new Error('Invalid contact');
  const status = input.status || 'customer';
  if (!['customer','subscribed','unsubscribed','suppressed'].includes(status)) throw new Error('Invalid status');
  const customerUpdates = input.source === 'lemonsqueezy' && ['legacy_provider_subscription','customer_release_updates'].includes(input.subscription_basis);
  if (status === 'subscribed' && !customerUpdates && (!input.consent_at || !Number.isFinite(Date.parse(input.consent_at)) || !input.consent_source)) throw new Error('Subscribed imports require consent evidence or an explicit customer-update basis');
  return { ...input, email, status, name: typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '' };
}
// Suppression wins over imports and purchases. Only confirmed signup can re-subscribe.
export function contactStatements(db, input) {
  const row = cleanContact(input);
  const now = new Date().toISOString();
  return [
    db.prepare(`INSERT INTO contacts (id,email,name,status,consent_at,consent_source,consent_version,unsubscribed_at,created_at,updated_at,subscription_basis)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET
      name=CASE WHEN contacts.name='' THEN excluded.name ELSE contacts.name END,
      status=CASE WHEN contacts.status='suppressed' OR excluded.status='suppressed' THEN 'suppressed'
        WHEN contacts.status='unsubscribed' OR excluded.status='unsubscribed' THEN 'unsubscribed'
        WHEN contacts.status='subscribed' OR excluded.status='subscribed' THEN 'subscribed' ELSE contacts.status END,
      consent_at=COALESCE(contacts.consent_at,excluded.consent_at),
      consent_source=COALESCE(contacts.consent_source,excluded.consent_source),
      consent_version=COALESCE(contacts.consent_version,excluded.consent_version),
      subscription_basis=COALESCE(contacts.subscription_basis,excluded.subscription_basis),
      unsubscribed_at=COALESCE(contacts.unsubscribed_at,excluded.unsubscribed_at),updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), row.email, row.name, row.status, row.consent_at || null, row.consent_source || null, row.consent_version || null, ['unsubscribed','suppressed'].includes(row.status) ? now : null, now, now, row.subscription_basis || null),
    db.prepare(`INSERT INTO contact_sources(contact_id,source,external_id,recorded_at)
      SELECT id,?,?,? FROM contacts WHERE email=? ON CONFLICT(source,external_id) DO NOTHING`)
      .bind(row.source, row.external_id, now, row.email)
  ];
}
