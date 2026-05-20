-- M365 Signature Manager — initial schema

-- Lokale Admin-User des Webtools (nicht M365-User)
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- M365 Tenant-Konfiguration (single-tenant: 1 Zeile)
CREATE TABLE IF NOT EXISTS tenant_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tenant_id TEXT,
  client_id TEXT,
  client_secret_encrypted TEXT,
  display_name TEXT,
  status TEXT DEFAULT 'unconfigured', -- unconfigured | configured | error
  last_sync_at DATETIME,
  last_error TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO tenant_config (id, status) VALUES (1, 'unconfigured');

-- M365-User (gesynced aus Graph)
CREATE TABLE IF NOT EXISTS m365_users (
  id TEXT PRIMARY KEY,                 -- Graph user.id (objectId)
  user_principal_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  given_name TEXT,
  surname TEXT,
  job_title TEXT,
  department TEXT,
  company_name TEXT,
  office_location TEXT,
  mail TEXT,
  business_phones TEXT,                -- JSON array
  mobile_phone TEXT,
  street_address TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT,
  preferred_language TEXT,
  account_enabled INTEGER DEFAULT 1,
  raw_json TEXT,                       -- vollstaendiges Graph-Payload als Backup
  template_id INTEGER REFERENCES signature_templates(id) ON DELETE SET NULL,
  custom_fields TEXT,                  -- JSON: per-User-Overrides
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_upn ON m365_users(user_principal_name);
CREATE INDEX IF NOT EXISTS idx_users_dept ON m365_users(department);

-- Signatur-Templates (HTML mit {{placeholders}})
CREATE TABLE IF NOT EXISTS signature_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  html_body TEXT NOT NULL,             -- Signatur (oben/unter Mail-Body)
  is_default INTEGER DEFAULT 0,        -- nur 1 Default erlaubt
  apply_to_new INTEGER DEFAULT 1,
  apply_to_reply INTEGER DEFAULT 1,
  apply_to_forward INTEGER DEFAULT 1,
  internal_only INTEGER DEFAULT 0,     -- 1 = nur fuer Mails an interne Domain
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Pflicht-Footer / Disclaimer (single row)
CREATE TABLE IF NOT EXISTS mandatory_footer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER DEFAULT 0,
  html_body TEXT,
  apply_to_new INTEGER DEFAULT 1,
  apply_to_reply INTEGER DEFAULT 1,
  apply_to_forward INTEGER DEFAULT 1,
  external_only INTEGER DEFAULT 1,     -- typisch nur extern
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO mandatory_footer (id, enabled, html_body) VALUES (1, 0, '');

-- Logos / Bild-Assets (base64 oder als Datei in uploads/)
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit-Log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- App-Settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('internal_domains', '[]'),
  ('signature_marker', 'X-M365-Signature-Manager'),
  ('encryption_key_set', '0');
