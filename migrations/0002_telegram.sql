CREATE TABLE IF NOT EXISTS channel_evidence (
  kind TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  message_id TEXT,
  response_status INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL
);
