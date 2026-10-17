-- Shop logo images live in the database (the production host has no writable disk).
CREATE TABLE IF NOT EXISTS shop_logos (
  name       TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       TEXT NOT NULL,   -- base64 of the image bytes
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
