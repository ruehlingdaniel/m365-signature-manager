-- Per-User-Steuerung: Beim Deploy alle vorhandenen Signaturen im
-- Outlook-Signatures-Ordner des Users durch die neue Signatur ersetzen.
-- 0 = nur die eigene Signatur (Default) ueberschreiben
-- 1 = kompletten Signatures-Ordner vorher leeren

ALTER TABLE signature_users ADD COLUMN replace_existing_signatures INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO settings (key, value) VALUES ('default_replace_existing', '0');
