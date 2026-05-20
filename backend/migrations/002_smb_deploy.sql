-- M365 Signature Manager — switch from Graph-API to SMB-deploy model.
-- Removes M365 tenant/Graph tables, adds manual users, terminal servers, deploy log.

DROP TABLE IF EXISTS m365_users;
DROP TABLE IF EXISTS tenant_config;

-- Mitarbeiter, manuell im Webinterface gepflegt
CREATE TABLE IF NOT EXISTS signature_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  windows_username TEXT NOT NULL UNIQUE,   -- AD-User-Anteil (ohne Domain), z.B. "jmueller"
  display_name TEXT NOT NULL,
  email TEXT,
  job_title TEXT,
  department TEXT,
  company TEXT,
  office_location TEXT,
  phone TEXT,
  mobile TEXT,
  fax TEXT,
  street TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT,
  website TEXT,
  custom_fields TEXT,                       -- JSON: beliebige zusaetzliche Felder
  template_id INTEGER REFERENCES signature_templates(id) ON DELETE SET NULL,
  signature_name TEXT NOT NULL DEFAULT 'Firma_Standard',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sig_users_username ON signature_users(windows_username);
CREATE INDEX IF NOT EXISTS idx_sig_users_dept ON signature_users(department);

-- Terminal Server, auf die per SMB deployed wird
CREATE TABLE IF NOT EXISTS terminal_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,                -- Anzeige-Name, z.B. "TS01"
  hostname TEXT NOT NULL,                   -- DNS oder IP fuer SMB-Verbindung
  share TEXT NOT NULL DEFAULT 'C$',         -- Admin-Share
  profile_path TEXT NOT NULL DEFAULT 'Users',-- Pfad bis zum User-Ordner
  domain TEXT,                              -- AD-Domain, z.B. "example.local"
  username TEXT NOT NULL,                   -- SMB-User, typ. Domain-Admin
  password_encrypted TEXT NOT NULL,         -- AES-GCM, ENCRYPTION_KEY
  enabled INTEGER DEFAULT 1,
  last_check_at DATETIME,
  last_check_ok INTEGER,
  last_check_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Deploy-Historie pro User pro Server
CREATE TABLE IF NOT EXISTS deploy_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES signature_users(id) ON DELETE CASCADE,
  server_id INTEGER REFERENCES terminal_servers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                     -- ok | skipped | error
  message TEXT,
  files_written INTEGER DEFAULT 0,
  bytes_written INTEGER DEFAULT 0,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deploy_user ON deploy_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_server ON deploy_log(server_id, created_at DESC);

-- Audit-Log erweitern um IP + Ziel
ALTER TABLE audit_log ADD COLUMN target TEXT;
ALTER TABLE audit_log ADD COLUMN ip TEXT;

-- Defaults setzen
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_signature_name', 'Firma_Standard');
INSERT OR IGNORE INTO settings (key, value) VALUES ('disable_roaming_signatures', '1');
