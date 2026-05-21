-- Default fuer Log-Retention setzen (90 Tage). Wird vom lib/log-cleanup.js gelesen,
-- vom Scheduler 1x pro Tag ausgefuehrt. Cleanup laeuft auf audit_log + deploy_log.

INSERT OR IGNORE INTO settings (key, value) VALUES ('log_retention_days', '90');
