CREATE TABLE IF NOT EXISTS monitor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL,
  state TEXT NOT NULL,
  cursor_block INTEGER,
  last_scheduled_at TEXT,
  last_success_at TEXT,
  last_range_from INTEGER,
  last_range_to INTEGER,
  next_check_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  event_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  amount_raw TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  detection_mode TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  config_snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  event_key TEXT PRIMARY KEY REFERENCES events(event_key),
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  message_id TEXT,
  response_status INTEGER,
  last_error TEXT,
  queued_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state, next_attempt_at);
