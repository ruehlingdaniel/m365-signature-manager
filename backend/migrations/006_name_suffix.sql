-- Namens-Zusatz fuer Titel/Funktion direkt am Namen (z.B. "ppa.", "Betriebswirt")
-- Wird im Template als {{nameSuffix}} bzw. unter dem Namen ausgegeben.

ALTER TABLE signature_users ADD COLUMN name_suffix TEXT;
