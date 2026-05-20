-- Asset-Library (Logos, Bilder, Social-Icons) — auf Disk, Metadaten in DB.
-- Aeltere BLOB-basierte Variante aus 001 wird verworfen (war ungenutzt).

DROP TABLE IF EXISTS assets;

CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- Anzeige-Name, z.B. "Firmenlogo"
  filename TEXT NOT NULL,          -- Original-Dateiname
  storage_path TEXT NOT NULL,      -- Pfad relativ zu data/assets/
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,                   -- optional
  height INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
