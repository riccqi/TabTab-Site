CREATE INDEX contact_sources_contact ON contact_sources(contact_id,source);
CREATE TABLE dashboard_settings (id INTEGER PRIMARY KEY CHECK(id=1), postal_address TEXT NOT NULL DEFAULT '', daily_limit INTEGER NOT NULL DEFAULT 100);
INSERT INTO dashboard_settings(id) VALUES(1);
CREATE TABLE dashboard_codes (id TEXT PRIMARY KEY, digest TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE dashboard_sessions (digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE email_usage (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE campaigns (id TEXT PRIMARY KEY, subject TEXT NOT NULL, markdown TEXT NOT NULL, preheader TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'draft', postal_address TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, last_error TEXT, test_hash TEXT);
CREATE TABLE campaign_recipients (campaign_id TEXT NOT NULL REFERENCES campaigns(id), contact_id TEXT NOT NULL REFERENCES contacts(id), state TEXT NOT NULL DEFAULT 'queued', claimed_at INTEGER, error TEXT, PRIMARY KEY(campaign_id,contact_id));
CREATE INDEX campaign_queue ON campaign_recipients(campaign_id,state,contact_id);
