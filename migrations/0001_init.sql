CREATE TABLE IF NOT EXISTS telegram_groups (
  chat_id TEXT PRIMARY KEY,
  title TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'mention',
  muse_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS telegram_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  content TEXT NOT NULL DEFAULT '',
  reply_to_message_id TEXT,
  media_type TEXT,
  media_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON telegram_messages(chat_id, created_at DESC);
CREATE TABLE IF NOT EXISTS telegram_updates_processed (
  update_id TEXT PRIMARY PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
