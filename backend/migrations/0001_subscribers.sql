CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'customer' CHECK (status IN ('customer','pending','subscribed','unsubscribed','suppressed')),
  consent_at TEXT,
  consent_source TEXT,
  consent_version TEXT,
  confirmation_nonce TEXT,
  confirmation_sent_at INTEGER,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX contacts_status ON contacts(status, id);
CREATE TABLE contact_sources (
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
CREATE TABLE deliveries (
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  content_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending','sent','failed','uncertain')),
  attempted_at TEXT NOT NULL,
  provider_id TEXT,
  PRIMARY KEY (campaign_id, contact_id)
);
