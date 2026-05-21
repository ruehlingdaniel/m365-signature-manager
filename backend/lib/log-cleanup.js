// Loescht alte Eintraege in audit_log und deploy_log nach `log_retention_days` Tagen.
// Default 90 Tage. Wird vom Scheduler einmal pro Tag aufgerufen.

import { db, getSetting, setSetting } from './db.js';

const DEFAULT_DAYS = 90;
const LAST_CLEANUP_KEY = 'log_cleanup_last_run';

export function runLogCleanup() {
  const days = parseInt(getSetting('log_retention_days') || DEFAULT_DAYS, 10);
  if (!Number.isFinite(days) || days < 1) {
    console.warn(`[log-cleanup] ungueltiges log_retention_days='${getSetting('log_retention_days')}' — uebersprungen`);
    return { skipped: true };
  }
  const cutoff = `-${days} days`;
  const a = db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', ?)`).run(cutoff);
  const d = db.prepare(`DELETE FROM deploy_log WHERE created_at < datetime('now', ?)`).run(cutoff);
  setSetting(LAST_CLEANUP_KEY, new Date().toISOString());
  console.log(`[log-cleanup] retention=${days}d: audit_log=${a.changes} deploy_log=${d.changes} geloescht`);
  return { audit_deleted: a.changes, deploy_deleted: d.changes, retention_days: days };
}

// Liefert true, wenn der letzte Cleanup-Lauf mehr als 23 Stunden her ist (oder noch nie).
export function shouldRunCleanup() {
  const last = getSetting(LAST_CLEANUP_KEY);
  if (!last) return true;
  const lastMs = Date.parse(last);
  if (Number.isNaN(lastMs)) return true;
  return (Date.now() - lastMs) > 23 * 3600 * 1000;
}
