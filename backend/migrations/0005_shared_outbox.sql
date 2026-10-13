DROP TABLE campaign_recipients;
DROP TABLE deliveries;
DROP TABLE email_usage;
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id),
  contact_id TEXT REFERENCES contacts(id),
  kind TEXT NOT NULL CHECK (kind IN ('announcement')),
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','retry','failed','ambiguous','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  message_id TEXT,
  error_code TEXT,
  UNIQUE (campaign_id, contact_id, kind)
);
CREATE INDEX delivery_queue ON deliveries(status, available_at);
CREATE INDEX delivery_campaign ON deliveries(campaign_id, status);
CREATE TABLE send_lock (id INTEGER PRIMARY KEY CHECK (id=1), next_at INTEGER NOT NULL);
INSERT INTO send_lock VALUES (1, 0);
