ALTER TABLE campaigns ADD COLUMN deleted_at TEXT CHECK (deleted_at IS NULL OR state='draft');
CREATE INDEX campaign_draft_trash ON campaigns(deleted_at,created_at);
